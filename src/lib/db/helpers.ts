import { filter, firstValueFrom, fromEvent, map } from 'rxjs'
import { createRandomHex } from '$lib/crypto.js'
import type { Channel } from '$lib/@types/channels.js'
import type { PaymentSummary } from '$lib/summary.js'
import type { InvoicePayment, Payment, TransactionPayment } from '$lib/@types/payments.js'

const worker = new Worker(new URL('./db.worker.ts', import.meta.url), {
  type: 'module'
})

const messages$ = fromEvent<MessageEvent>(worker, 'message')

export const updateChannels = async (channels: Channel[]): Promise<void> => {
  const id = createRandomHex()

  const complete = firstValueFrom(
    messages$.pipe(
      filter(message => message.data.id === id),
      map(message => {
        if (message.data.error) {
          throw new Error(message.data.error)
        }
      })
    )
  )

  worker.postMessage({ id, type: 'update_channels', channels })

  return complete
}

export const updateTransactions = async (transactions: TransactionPayment[]): Promise<void> => {
  const id = createRandomHex()

  const complete = firstValueFrom(
    messages$.pipe(
      filter(message => message.data.id === id),
      map(message => {
        if (message.data.error) {
          throw new Error(message.data.error)
        }
      })
    )
  )

  worker.postMessage({ id, type: 'update_transactions', transactions })

  return complete
}

export const bulkPut = async (table: string, data: unknown[]): Promise<void> => {
  const id = createRandomHex()

  const complete = firstValueFrom(
    messages$.pipe(
      filter(message => message.data.id === id),
      map(message => {
        if (message.data.error) {
          throw new Error(message.data.error)
        }
      })
    )
  )

  worker.postMessage({ id, type: 'bulk_put', table, data })

  return complete
}

export const getLastPaidInvoice = async (walletId: string): Promise<InvoicePayment> => {
  const id = createRandomHex()

  const complete = firstValueFrom(
    messages$.pipe(
      filter(message => message.data.id === id),
      map(message => {
        if (message.data.error) {
          throw new Error(message.data.error)
        }

        return message.data.result
      })
    )
  )

  worker.postMessage({ id, type: 'get_lastpay_index', walletId })

  return complete as Promise<InvoicePayment>
}

export const getPaymentSummary = async (payment: Payment): Promise<PaymentSummary> => {
  const id = createRandomHex()

  const complete = firstValueFrom(
    messages$.pipe(
      filter(message => message.data.id === id),
      map(message => {
        if (message.data.error) {
          throw new Error(message.data.error)
        }

        return message.data.result
      })
    )
  )

  worker.postMessage({ id, type: 'get_payment_summary', payment })

  return complete as Promise<PaymentSummary>
}

export const getAllTags = (): Promise<string[]> => {
  const id = createRandomHex()

  const complete = firstValueFrom(
    messages$.pipe(
      filter(message => message.data.id === id),
      map(message => {
        if (message.data.error) {
          throw new Error(message.data.error)
        }

        return message.data.result
      })
    )
  )

  worker.postMessage({ id, type: 'get_all_tags' })

  return complete as Promise<string[]>
}
