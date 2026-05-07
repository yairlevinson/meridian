const READ_ONLY_COMMANDS = new Set<string>([
  'calibration:getState',
  'camera:getState',
  'firmware:getBoardInfo',
  'forwarding:getState',
  'links:getAll',
  'links:listSerialPorts',
  'parameters:getAll',
  'radar:getState',
  'settings:getAll',
  'vehicle:trackingGetEngagement',
  'video:getState'
])

export function isReadOnlyRpcCommand(moduleName: string, commandName: string): boolean {
  return READ_ONLY_COMMANDS.has(`${moduleName}:${commandName}`)
}
