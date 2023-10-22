import type { Metadata } from './metadata.js'
import type { FiatDenomination } from './settings.js'

export type Trade = {
  /** randomly generated by app */
  id: string
  /** unix seconds */
  timestamp: number
  /** the wallet that made this trade */
  walletId: string
  /** amount in sats */
  amount: number
  /** the price of Bitcoin */
  price: number
  /** fee in sats */
  fee: number
  /** the fiat denomination on the other side of the trade */
  fiatDenomination: FiatDenomination
  side: 'buy' | 'sell'
  tradeId?: string
  orderId?: string
  metadata?: Metadata
}
