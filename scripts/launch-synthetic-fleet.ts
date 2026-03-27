#!/usr/bin/env npx tsx
/**
 * Launches 10 SyntheticVehicle instances streaming to the app's UDP port.
 * Usage: npx tsx scripts/launch-synthetic-fleet.ts [port] [count]
 *   port  — UDP port (default 14550)
 *   count — number of vehicles (default 10)
 */
import { SyntheticVehicle } from '../test/e2e/helpers/SyntheticVehicle'

const port = parseInt(process.argv[2] || '14550', 10)
const count = parseInt(process.argv[3] || '10', 10)

const vehicles: SyntheticVehicle[] = []

for (let i = 1; i <= count; i++) {
  const v = new SyntheticVehicle(port, i)
  // Spread vehicles along a line, ~100m apart
  const lat = 42.3898 + (i - 1) * 0.001
  const lon = -71.1476
  const alt = 10 + i * 5
  v.startStreaming({ lat, lon, alt, armed: i % 2 === 0 })
  vehicles.push(v)
  console.log(`Vehicle ${i}: sysid=${i}, lat=${lat.toFixed(4)}, alt=${alt}m, armed=${i % 2 === 0}`)
}

console.log(`\n${count} vehicles streaming to UDP port ${port}. Press Ctrl+C to stop.`)

process.on('SIGINT', () => {
  console.log('\nStopping all vehicles...')
  for (const v of vehicles) v.stop()
  process.exit(0)
})
