import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/pages/KitchenPage.tsx', import.meta.url), 'utf8')
const unlock = source.slice(source.indexOf('const unlock = () =>'), source.indexOf('async function changeStatus'))
const prime = source.slice(source.indexOf('async function primeKitchenBell'), source.indexOf('async function playKitchenBell'))
const alert = source.slice(source.indexOf('function notifyKitchen'), source.indexOf('function getKitchenAudio'))

assert.ok(unlock.includes('void primeKitchenBell()'), 'Phải giữ bước mở khóa chuông trong tương tác đầu tiên để đơn mới vẫn có thể phát chuông.')
assert.ok(!/playKitchenBell\(\)/.test(unlock), 'Tương tác đầu tiên không được gọi đường phát chuông có tiếng.')

const muteAt = prime.indexOf('audio.muted = true')
const playAt = prime.indexOf('await audio.play()')
const pauseAt = prime.indexOf('audio.pause()')
const restoreAt = prime.indexOf('audio.muted = oldMuted')
assert.ok(muteAt >= 0 && muteAt < playAt, 'Phải mute media trước khi play để prime im lặng trên Safari/iOS.')
assert.ok(playAt < pauseAt && pauseAt < restoreAt, 'Chỉ được khôi phục mute sau khi media đã pause và reset.')
assert.ok(prime.includes('const oldMuted = audio.muted'), 'Phải giữ và khôi phục trạng thái muted trước đó của thiết bị.')
assert.ok(alert.includes('void playKitchenBell()'), 'Đơn pending mới vẫn phải đi qua đường phát chuông có tiếng.')
assert.match(source, /if \(!hasPending\) return[\s\S]*?playKitchenBell\(\), 60000/, 'Nhắc chuông 60 giây chỉ được chạy khi thực sự có đơn pending.')

console.log('KITCHEN_IDLE_BELL_OK')
