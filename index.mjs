import { alloc, reader } from './shared.mjs'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'

const __dirname = path.dirname(new URL(import.meta.url).pathname)

setInterval(() => {
	console.log("#")
}, 1e3)

const numValues = 1000
const size = 39
const minWrite = 4
const maxWrite = size - 8
const slowReader = false
const asyncWriter = true // !!rand(2)
console.log('TEST', { size, slowReader, asyncWriter })

const shared = alloc(size)
const workerPath = path.join(__dirname, 'write-async-worker.mjs')
const worker = new Worker(workerPath, { workerData: { shared, numValues, minWrite, maxWrite } })
worker.on('error', console.error)

await new Promise((resolve) => {
	let expected = 0
	reader(shared, async (data) => {
		const value = data.readInt32LE(0)
		if (value !== expected) {
			throw new Error(`wrong value actual=${value} expected=${expected}`)
		}
		expected++
		if (expected === numValues) {
			resolve()
		}
		if (slowReader) {
			await setTimeout(1)
		}
	})
})
