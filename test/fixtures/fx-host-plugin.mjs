import host from 'fx:host'

const { path, fs } = host.modules
const sleep = host.modules['timers/promises'].setTimeout

const file = path.join('fx-host-plugin-out', 'note.txt')
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, 'hello')
const read = fs.readFileSync(file, 'utf8')
await sleep(5)
console.log(JSON.stringify({
  interface: host.version.interface,
  host: host.version.host,
  hasFs: host.capabilities.includes('fs'),
  hasTimers: host.capabilities.includes('timers/promises'),
  joined: file,
  read,
  slept: true,
}))
