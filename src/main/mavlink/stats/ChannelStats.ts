/**
 * Per-channel packet statistics.
 */
export class ChannelStats {
  totalReceived = 0
  totalLoss = 0

  /** Running loss percentage (0..100) */
  get lossPercent(): number {
    const total = this.totalReceived + this.totalLoss
    if (total === 0) return 0
    return (this.totalLoss / total) * 100
  }

  reset(): void {
    this.totalReceived = 0
    this.totalLoss = 0
  }
}
