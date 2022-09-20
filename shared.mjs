import assert from 'node:assert'
import tp from 'node:timers/promises'

const WRITE_INDEX = 0
const READ_INDEX = 1

export function alloc(size) {
  return {
    sharedState: new SharedArrayBuffer(16),
    sharedBuffer: new SharedArrayBuffer(size),
  }
}

// TODO (fix): Max number of bytes written/read is 2^53-1 which
// is enough for 1 MiB/s for 285 years or 1 GiB/s per 0.285 years.
// Total amount of that is split between all workers. With 16
// workers the above increases to 4560 and 4.560 years. Being able
// to handle infinite amount of data would be preferrable but is
// more complicated.

export async function reader({ sharedState, sharedBuffer }, cb) {
  const state = new BigInt64Array(sharedState)
  const buffer = Buffer.from(sharedBuffer)
  const size = buffer.byteLength - 4
  const yieldLen = 256 * 1024

  let readPos = 0
  let writePos = 0
  let yieldPos = readPos + yieldLen

  function notifyNT() {
    Atomics.store(state, READ_INDEX, BigInt(readPos))
    Atomics.notify(state, READ_INDEX)
  }

  while (true) {
    const endPos = Math.min(writePos, yieldPos)

    while (readPos < endPos) {
      const dataPos = (readPos % size) + 4
      const dataLen = buffer.readInt32LE(dataPos - 4)

      if (dataLen < 0) {
        readPos -= dataLen
      } else {
        assert(dataLen >= 0)
        assert(dataLen + 4 <= size, dataLen)
        assert(dataPos + dataLen <= size)

        const thenable = cb(Buffer.from(sharedBuffer, dataPos, dataLen))
        if (thenable) {
          notifyNT()
          await thenable
        }
        readPos += dataLen + 4
      }

      // Yield to IO sometimes.
      if (readPos >= yieldPos) {
        yieldPos = readPos + yieldLen
        notifyNT()
        await tp.setImmediate()
      }
    }

    notifyNT()

    if (writePos <= readPos) {
      const valueN = Atomics.load(state, WRITE_INDEX)
      // eslint-disable-next-line eqeqeq
      if (valueN != writePos) {
        writePos = Number(valueN)
      } else {
        const { async, value: promise } = Atomics.waitAsync(state, WRITE_INDEX, valueN)
        if (async) {
          await promise
        }
        writePos = Number(Atomics.load(state, WRITE_INDEX))
      }
    }
  }
}

export function writer({ sharedState, sharedBuffer }) {
  const state = new BigInt64Array(sharedState)
  const buffer = Buffer.from(sharedBuffer)
  const size = buffer.byteLength - 4

  let writePos = 0
  let readPos = 0
  let notifying = false

  function notifyNT() {
    if (notifying) {
      Atomics.store(state, WRITE_INDEX, BigInt(writePos))
      Atomics.notify(state, WRITE_INDEX)
      notifying = false
    }
  }

  function notify () {
    if (!notifying) {
      notifying = true
      queueMicrotask(notifyNT)
    }
  }

  async function wait(len) {
    while (true) {
      const required = len + 4
      const used = writePos - readPos
      const available = size - used

      if (available >= required) {
        const seqPos = writePos % size
        const seqLen = size - seqPos

        if (seqLen >= required) {
          return
        }

        buffer.writeInt32LE(-seqLen, seqPos)
        writePos += seqLen
        notify()
      } else {
        const valueN = Atomics.load(state, READ_INDEX)
        // eslint-disable-next-line eqeqeq
        if (valueN != readPos) {
          readPos = Number(valueN)
        } else {
          notifyNT()

          // Fake waitAsync to solve deadlock in production...
          // Atomics.wait(state, READ_INDEX, valueN, 100)
          // await tp.setImmediate()

          process._rawDebug('wait started')
          const { async, value: promise } = Atomics.waitAsync(state, READ_INDEX, valueN, 100)
          if (async) {
            await promise
          }
          process._rawDebug('wait completed')

          readPos = Number(Atomics.load(state, READ_INDEX))
        }
      }
    }
  }

  function write(len, fn, arg1, arg2, arg3) {
    assert(len >= 0)
    assert(len + 4 <= size)

    const dataPos = (writePos % size) + 4
    const dataLen = fn(dataPos, buffer, arg1, arg2, arg3) - dataPos

    if (dataLen < 0 || dataLen > len) {
      throw new Error(`invalid data size: ${dataLen}`)
    }

    assert(dataPos + dataLen <= size, dataLen)

    buffer.writeInt32LE(dataLen, dataPos - 4)
    writePos += dataLen + 4
    notify()
  }

  return {
    write,
    wait
  }
}
