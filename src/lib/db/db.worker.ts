import type { Channel } from '$lib/@types/channels.js'
import { db } from './index.js'
import type { DBGetPaymentsOptions, ValueOf } from '$lib/@types/common.js'

import {
  deriveAddressSummary,
  deriveInvoiceSummary,
  deriveTransactionSummary,
  type PaymentSummary
} from '$lib/summary.js'

import type { AddressPayment, Payment, TransactionPayment } from '$lib/@types/payments.js'

type MessageBase = {
  id: string
}

type UpdateChannelsMessage = MessageBase & {
  type: 'update_channels'
  channels: Channel[]
}

type UpdateTransactionsMessage = MessageBase & {
  type: 'update_transactions'
  transactions: TransactionPayment[]
}

type BulkPutMessage = MessageBase & {
  type: 'bulk_put'
  table: string
  data: unknown[]
}

type GetLastPayMessage = MessageBase & {
  type: 'get_lastpay_index'
  walletId: string
}

type GetPaymentsMessage = MessageBase & {
  type: 'get_payments'
} & DBGetPaymentsOptions

type GetPaymentSummaryMessage = MessageBase & {
  type: 'get_payment_summary'
  payment: Payment
}

type GetAllTagsMessage = MessageBase & {
  type: 'get_all_tags'
}

type Message =
  | UpdateChannelsMessage
  | UpdateTransactionsMessage
  | BulkPutMessage
  | GetLastPayMessage
  | GetPaymentSummaryMessage
  | GetAllTagsMessage
  | GetPaymentsMessage

onmessage = async (message: MessageEvent<Message>) => {
  switch (message.data.type) {
    case 'update_channels': {
      try {
        await Promise.all(
          message.data.channels.map(async channel => {
            // need to update channels as old channels lose data after 100 blocks of being close
            // so we don't want to overwrite data we already have as it is useful
            await db.channels
              .where({ id: channel.id, walletId: channel.walletId })
              .modify(channel)
              .then(async updated => {
                if (!updated) {
                  await db.channels.add(channel)
                }
              })
          })
        )

        self.postMessage({ id: message.data.id })
      } catch (error) {
        const { message: errMsg } = error as Error
        self.postMessage({ id: message.data.id, error: errMsg })
      }

      return
    }
    case 'update_transactions': {
      try {
        const { transactions } = message.data

        const addressesWithoutTxid = await db.payments
          .where({ walletId: transactions[0].walletId, type: 'address' })
          .filter(payment => !(payment as AddressPayment).data.txid)
          .toArray()

        // update all addresses that have a corresponding tx
        await Promise.all(
          addressesWithoutTxid.map(address => {
            const tx = transactions.find(transaction =>
              (transaction as TransactionPayment).data.outputs.find(
                output => output.address === address.id
              )
            )

            if (tx) {
              return db.payments.update(address.id, {
                data: { txid: tx.id, completedAt: tx.timestamp }
              })
            }

            return Promise.resolve()
          })
        )

        await db.payments.bulkPut(transactions)

        self.postMessage({ id: message.data.id })
      } catch (error) {
        const { message: errMsg } = error as Error
        self.postMessage({ id: message.data.id, error: errMsg })
      }

      return
    }
    case 'bulk_put': {
      try {
        // eslint-disable-next-line
        // @ts-ignore
        await db[message.data.table].bulkPut(message.data.data)
        self.postMessage({ id: message.data.id })
      } catch (error) {
        const { message: errMsg } = error as Error
        self.postMessage({ id: message.data.id, error: errMsg })
      }

      return
    }
    case 'get_lastpay_index': {
      try {
        const lastPaidInvoice = await db.payments.orderBy('data.payIndex').reverse().first()
        self.postMessage({ id: message.data.id, result: lastPaidInvoice })
      } catch (error) {
        const { message: errMsg } = error as Error
        self.postMessage({ id: message.data.id, error: errMsg })
      }

      return
    }
    case 'get_payment_summary': {
      const { payment } = message.data

      let summary: PaymentSummary

      try {
        if (payment.type === 'transaction') {
          summary = await deriveTransactionSummary(payment)
        } else if (payment.type === 'invoice') {
          summary = await deriveInvoiceSummary(payment)
        } else {
          summary = await deriveAddressSummary(payment)
        }

        self.postMessage({ id: message.data.id, result: summary })
      } catch (error) {
        const { message: errMsg } = error as Error
        self.postMessage({ id: message.data.id, error: errMsg })
      }

      return
    }
    case 'get_all_tags': {
      const metadataWithTags = await db.metadata.filter(({ tags }) => !!tags.length).toArray()
      const allTags = metadataWithTags.reduce((acc, { tags }) => {
        acc.concat(tags)
        return acc
      }, [] as string[])

      self.postMessage({ id: message.data.id, result: allTags })

      return
    }
    case 'get_payments': {
      const { offset, limit, sort, filters } = message.data

      let payments = db.payments.orderBy(sort.key)

      if (sort.direction === 'desc') {
        payments = payments.reverse()
      }

      if (filters) {
        payments = payments.filter(payment => {
          const passes = filters.every(filter => {
            const { type, key } = filter
            const keys = key.split('.')

            let valueToTest: ValueOf<Payment> = payment[keys[0] as keyof Payment]

            if (keys.length > 1) {
              valueToTest = keys
                .slice(1)
                .reduce(
                  (acc, key) => acc[key as keyof ValueOf<Payment>],
                  valueToTest as ValueOf<Payment>
                )
            }

            if (type === 'exists' && !valueToTest) return false

            if (type === 'one-of') {
              if (!filter.values.find(({ value }) => value === valueToTest)) return false
            }

            if (type === 'amount-range' || type === 'date-range') {
              const {
                values: { gt, lt }
              } = filter
              if (gt && (valueToTest as number) <= gt) return false
              if (lt && (valueToTest as number) >= lt) return false
            }

            return true
          })

          return passes
        })
      }

      return payments.distinct().offset(offset).limit(limit)
    }
  }
}

export {}
