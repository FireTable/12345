class CivicAsrProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options && options.processorOptions ? options.processorOptions : {};
    this._chunkSize =
      typeof opts.chunkSize === "number" && opts.chunkSize > 0 ? opts.chunkSize : 1024;
    this._buffer = new Float32Array(this._chunkSize);
    this._offset = 0;
    this._active = true;
    this.port.onmessage = (event) => {
      if (event && event.data === "stop") {
        if (this._offset > 0) {
          const tail = this._buffer.slice(0, this._offset);
          this._offset = 0;
          this.port.postMessage(tail, [tail.buffer]);
        }
        this._active = false;
      }
    };
  }

  process(inputs) {
    if (!this._active) return false;
    const input = inputs && inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;

    let idx = 0;
    while (idx < input.length) {
      const take = Math.min(this._chunkSize - this._offset, input.length - idx);
      this._buffer.set(input.subarray(idx, idx + take), this._offset);
      this._offset += take;
      idx += take;
      if (this._offset >= this._chunkSize) {
        const out = this._buffer;
        this._buffer = new Float32Array(this._chunkSize);
        this._offset = 0;
        this.port.postMessage(out, [out.buffer]);
      }
    }
    return true;
  }
}

registerProcessor("civic-asr-processor", CivicAsrProcessor);
