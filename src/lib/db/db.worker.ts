import type { Channel } from '$lib/@types/channels.js'
import { db } from './index.js'

import {
  deriveAddressSummary,
  deriveInvoiceSummary,
  deriveTransactionSummary,
  type PaymentSummary
} from '$lib/summary.js'
import type {
  AddressPayment,
  InvoicePayment,
  Payment,
  TransactionPayment
} from '$lib/@types/payments.js'

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
  offset: number
}

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
        const [lastPaidInvoice] = await db.payments
          .where({ walletId: message.data.walletId, direction: 'receive', type: 'invoice' })
          .filter(payment => typeof (payment as InvoicePayment).data.payIndex !== 'undefined')
          .reverse()
          .sortBy('payIndex')

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
      const { offset = 0 } = message.data

      // const result = db.transaction(
      //   'r',
      //   db.invoices,
      //   db.transactions,
      //   db.addresses,
      //   db.utxos,
      //   db.channels,
      //   async () => {
      //     const invoices = db.invoices
      //       .orderBy('timestamp')
      //       .reverse()
      //       .limit(50)
      //       .toArray()
      //       .then(invs =>
      //         Array.from(
      //           invs
      //             .reduce((acc, inv) => {
      //               const current = acc.get(inv.hash)

      //               // if duplicates (we are both parties to invoice), keep the sender copy
      //               if (!current || current.direction === 'receive') {
      //                 acc.set(inv.hash, inv)
      //               }

      //               return acc
      //             }, new Map<string, Invoice>())
      //             .values()
      //         )
      //       )
      //       .then(invs =>
      //         invs.map(data => {
      //           const {
      //             id,
      //             status,
      //             completedAt,
      //             createdAt,
      //             amount,
      //             request,
      //             fee,
      //             walletId,
      //             offer
      //           } = data
      //           return {
      //             id,
      //             type: 'invoice' as const,
      //             status,
      //             timestamp: completedAt || createdAt,
      //             walletId,
      //             amount,
      //             network: request ? getNetwork(request) : 'bitcoin',
      //             fee,
      //             offer: !!offer,
      //             data
      //           }
      //         })
      //       )

      //     const transactions = db.transactions
      //       .toArray()
      //       .then(async txs => {
      //         const deduped: Map<string, Transaction> = new Map()

      //         for (const tx of txs) {
      //           const current = deduped.get(tx.id)

      //           // dedupes txs and prefers the tx where if a channel close, the closer or the wallet that is the sender (spender of an input utxo)
      //           if (current) {
      //             const spentInputUtxo = await db.utxos
      //               .where('id')
      //               .anyOf(tx.inputs.map(({ txid, index }) => `${txid}:${index}`))
      //               .first()

      //             let channel: Channel | undefined

      //             if (tx.channel) {
      //               const channels = await db.channels.where({ id: tx.channel.id }).toArray()
      //               channel = channels.find(
      //                 ({ opener, closer }) =>
      //                   ((tx.channel?.type === 'close' || tx.channel?.type === 'force_close') &&
      //                     closer === 'local') ||
      //                   opener === 'local'
      //               )
      //             }

      //             // favour channel closer or opener
      //             if (channel?.walletId === tx.walletId) {
      //               deduped.set(tx.id, tx)
      //             } else if (spentInputUtxo?.walletId === tx.walletId) {
      //               // favour spender
      //               deduped.set(tx.id, tx)
      //             }
      //           } else {
      //             deduped.set(tx.id, tx)
      //           }
      //         }

      //         return Array.from(deduped.values())
      //       })
      //       .then(txs =>
      //         txs.map(data => {
      //           const { id, timestamp, blockheight, outputs, fee, walletId, channel } = data
      //           return {
      //             id,
      //             type: 'transaction' as const,
      //             status: (blockheight ? 'complete' : 'pending') as PaymentStatus,
      //             timestamp,
      //             walletId,
      //             network: getNetwork(outputs[0].address),
      //             fee,
      //             channel: !!channel,
      //             data
      //           }
      //         })
      //       )

      //     const addresses = db.addresses
      //       .filter(({ txid }) => !txid)
      //       .toArray()
      //       .then(addrs =>
      //         addrs.map(data => {
      //           const { id, createdAt, walletId, amount, value } = data
      //           return {
      //             id,
      //             type: 'address' as const,
      //             status: 'waiting' as PaymentStatus,
      //             timestamp: createdAt,
      //             walletId,
      //             amount,
      //             network: getNetwork(value),
      //             data
      //           }
      //         })
      //       )

      //     return Promise.all([invoices, transactions, addresses]).then(results => results.flat())
      //   }
      // )
    }
  }
}

export {}
