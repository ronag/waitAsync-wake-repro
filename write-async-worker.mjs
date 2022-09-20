import { writer } from './shared.mjs'
import { parentPort, workerData } from 'node:worker_threads'

const { shared, numValues, minWrite, maxWrite } = workerData

const rand = (n) => Math.floor(Math.random() * n)
const randInt = (a, b) => rand(b - a + 1) + a

const { write, wait } = writer(shared)

for (let i = 0; i < numValues; i++) {
  const writeSize = randInt(minWrite, maxWrite)
  await wait(writeSize)
  write(writeSize, (dataPos, buffer) => {
    buffer.fill(0, dataPos, writeSize)
    buffer.writeInt32LE(i, dataPos)
    return dataPos + writeSize
  })
}

parentPort.postMessage('done')
