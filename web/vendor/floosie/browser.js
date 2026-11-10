var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from2, except, desc) => {
  if (from2 && typeof from2 === "object" || typeof from2 === "function") {
    for (let key of __getOwnPropNames(from2))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from2[key], enumerable: !(desc = __getOwnPropDesc(from2, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/unwind-array/src/index.js
var require_src = __commonJS({
  "node_modules/unwind-array/src/index.js"(exports, module) {
    var unwind2 = (dataObject, options) => {
      const unwindRecursive = (dataObject2, path, currPath) => {
        const pathArr = path.split(".");
        if (!currPath) {
          currPath = pathArr[0];
        }
        const result = [];
        let added = false;
        const addObject = (objectTempUnwind, objectKey) => {
          Object.keys(objectTempUnwind).forEach((objectTempUnwindKey) => {
            const newObjectCopy = {};
            Object.keys(dataObject2).forEach((dataObjectKey) => {
              newObjectCopy[dataObjectKey] = dataObject2[dataObjectKey];
            });
            newObjectCopy[objectKey] = objectTempUnwind[objectTempUnwindKey];
            added = true;
            result.push(newObjectCopy);
          });
        };
        Object.keys(dataObject2).forEach((objectKey) => {
          if (currPath === objectKey) {
            if (dataObject2[objectKey] instanceof Array) {
              if (dataObject2[objectKey].length === 0 && options.preserveEmptyArray !== true) {
                delete dataObject2[objectKey];
              } else {
                Object.keys(dataObject2[objectKey]).forEach((objectElementKey) => {
                  addObject(
                    unwindRecursive(dataObject2[objectKey][objectElementKey], path.replace(`${currPath}.`, "")),
                    objectKey
                  );
                });
              }
            } else {
              addObject(unwindRecursive(dataObject2[objectKey], path.replace(`${currPath}.`, "")), objectKey);
            }
          }
        });
        if (!added) {
          result.push(dataObject2);
        }
        return result;
      };
      return unwindRecursive(dataObject, options.path);
    };
    module.exports = { unwind: unwind2 };
  }
});

// src/chunk-factories.ts
var mk = (base, meta) => meta !== void 0 ? { ...base, meta } : base;
var json = (data, meta) => mk({ type: "json", data }, meta);
var binary = (data, meta) => mk({ type: "binary", data }, meta);
var text = (data, meta) => mk({ type: "text", data }, meta);
var raw = (data, meta) => mk({ type: "raw", data }, meta);
var image = (data, meta) => mk({ type: "image", data }, meta);
var video = (data, meta) => mk({ type: "video", data }, meta);
var ndjson = (data, meta) => mk({ type: "ndjson", data }, meta);
var csv = (data, meta) => mk({ type: "csv", data }, meta);
var xml = (data, meta) => mk({ type: "xml", data }, meta);
var yaml = (data, meta) => mk({ type: "yaml", data }, meta);
var markdown = (data, meta) => mk({ type: "markdown", data }, meta);
var html = (data, meta) => mk({ type: "html", data }, meta);
var sql = (data, meta) => mk({ type: "sql", data }, meta);
var httpRequest = (data, meta) => mk({ type: "http-request", data }, meta);
var httpResponse = (data, meta) => mk({ type: "http-response", data }, meta);
var websocket = (data, meta) => mk({ type: "websocket", data }, meta);
var sse = (data, meta) => mk({ type: "sse", data }, meta);
var audio = (data, meta) => mk({ type: "audio", data }, meta);
var pdf = (data, meta) => mk({ type: "pdf", data }, meta);
var archive = (data, meta) => mk({ type: "archive", data }, meta);
var embedding = (data, meta) => mk({ type: "embedding", data }, meta);
var token = (data, meta) => mk({ type: "token", data }, meta);
var delta = (data, meta) => mk({ type: "delta", data }, meta);
var uint8 = (data, meta) => mk({ type: "uint8", data }, meta);
var int32 = (data, meta) => mk({ type: "int32", data }, meta);
var float64 = (data, meta) => mk({ type: "float64", data }, meta);
var bool = (data, meta) => mk({ type: "bool", data }, meta);
var timestamp = (data, meta) => mk({ type: "timestamp", data }, meta);
var uuid = (data, meta) => mk({ type: "uuid", data }, meta);
var error = (data, meta) => mk({ type: "error", data }, meta);
var signal = (data, meta) => mk({ type: "signal", data }, meta);
var nil = (meta) => mk({ type: "null", data: null }, meta);
var protobuf = (data, meta) => mk({ type: "protobuf", data }, meta);
var msgpack = (data, meta) => mk({ type: "msgpack", data }, meta);
var cbor = (data, meta) => mk({ type: "cbor", data }, meta);
var arrow = (data, meta) => mk({ type: "arrow", data }, meta);
var parquet = (data, meta) => mk({ type: "parquet", data }, meta);
var geojson = (data, meta) => mk({ type: "geojson", data }, meta);
var jwt = (data, meta) => mk({ type: "jwt", data }, meta);
var graphql = (data, meta) => mk({ type: "graphql", data }, meta);
var rpc = (data, meta) => mk({ type: "rpc", data }, meta);
var event = (data, meta) => mk({ type: "event", data }, meta);
var span = (data, meta) => mk({ type: "span", data }, meta);
var metric = (data, meta) => mk({ type: "metric", data }, meta);
var log = (data, meta) => mk({ type: "log", data }, meta);
var command = (data, meta) => mk({ type: "command", data }, meta);
var frame = (data, meta) => mk({ type: "frame", data }, meta);
var patch = (data, meta) => mk({ type: "patch", data }, meta);
var multipart = (data, meta) => mk({ type: "multipart", data }, meta);
var wasm = (data, meta) => mk({ type: "wasm", data }, meta);
var font = (data, meta) => mk({ type: "font", data }, meta);
var onnx = (data, meta) => mk({ type: "onnx", data }, meta);
var safetensors = (data, meta) => mk({ type: "safetensors", data }, meta);
var epub = (data, meta) => mk({ type: "epub", data }, meta);
var docx = (data, meta) => mk({ type: "docx", data }, meta);
var xlsx = (data, meta) => mk({ type: "xlsx", data }, meta);
var pptx = (data, meta) => mk({ type: "pptx", data }, meta);
var gltf = (data, meta) => mk({ type: "gltf", data }, meta);
var qrcode = (data, meta) => mk({ type: "qrcode", data }, meta);
var toml = (data, meta) => mk({ type: "toml", data }, meta);
var ini = (data, meta) => mk({ type: "ini", data }, meta);
var jsonschema = (data, meta) => mk({ type: "jsonschema", data }, meta);
var avroschema = (data, meta) => mk({ type: "avroschema", data }, meta);
var sourcemap = (data, meta) => mk({ type: "sourcemap", data }, meta);
var shader = (data, meta) => mk({ type: "shader", data }, meta);
var obj = (data, meta) => mk({ type: "obj", data }, meta);
var subtitle = (data, meta) => mk({ type: "subtitle", data }, meta);
var playlist = (data, meta) => mk({ type: "playlist", data }, meta);
var graphml = (data, meta) => mk({ type: "graphml", data }, meta);
var socketio = (data, meta) => mk({ type: "socketio", data }, meta);
var webtransport = (data, meta) => mk({ type: "webtransport", data }, meta);
var envelope = (data, meta) => mk({ type: "envelope", data }, meta);
var ack = (data, meta) => mk({ type: "ack", data }, meta);
var nack = (data, meta) => mk({ type: "nack", data }, meta);
var ast = (data, meta) => mk({ type: "ast", data }, meta);
var hash = (data, meta) => mk({ type: "hash", data }, meta);
var signature = (data, meta) => mk({ type: "signature", data }, meta);
var tensor = (data, meta) => mk({ type: "tensor", data }, meta);
var timeseries = (data, meta) => mk({ type: "timeseries", data }, meta);
var ohlcv = (data, meta) => mk({ type: "ohlcv", data }, meta);
var adjacency = (data, meta) => mk({ type: "adjacency", data }, meta);
var pointcloud = (data, meta) => mk({ type: "pointcloud", data }, meta);
var keypair = (data, meta) => mk({ type: "keypair", data }, meta);
var certificate = (data, meta) => mk({ type: "certificate", data }, meta);
var hmac = (data, meta) => mk({ type: "hmac", data }, meta);
var dns = (data, meta) => mk({ type: "dns", data }, meta);
var dhcp = (data, meta) => mk({ type: "dhcp", data }, meta);
var icmp = (data, meta) => mk({ type: "icmp", data }, meta);
var ciphertext = (data, meta) => mk({ type: "ciphertext", data }, meta);
var int8 = (data, meta) => mk({ type: "int8", data }, meta);
var int16 = (data, meta) => mk({ type: "int16", data }, meta);
var uint16 = (data, meta) => mk({ type: "uint16", data }, meta);
var uint32 = (data, meta) => mk({ type: "uint32", data }, meta);
var int64 = (data, meta) => mk({ type: "int64", data }, meta);
var uint64 = (data, meta) => mk({ type: "uint64", data }, meta);
var float32 = (data, meta) => mk({ type: "float32", data }, meta);
var complex64 = (data, meta) => mk({ type: "complex64", data }, meta);
var complex128 = (data, meta) => mk({ type: "complex128", data }, meta);

// src/codec-text.ts
var enc = new TextEncoder();
var dec = new TextDecoder();
var utf8Codec = (type) => {
  return {
    encode: (c) => enc.encode(c.data),
    decode: (b, meta) => {
      const data = dec.decode(b);
      return meta !== void 0 ? { type, data, meta } : { type, data };
    }
  };
};
var JSON_CODEC = {
  encode: (c) => enc.encode(JSON.stringify(c.data)),
  decode: (b, meta) => {
    const str = dec.decode(b);
    try {
      const data = JSON.parse(str);
      return meta !== void 0 ? { type: "json", data, meta } : { type: "json", data };
    } catch (e) {
      throw new Error(`json decode failed: ${str.slice(0, 80)} \u2014 ${String(e)}`);
    }
  }
};
var RAW_CODEC = {
  encode: (c) => enc.encode(JSON.stringify(c.data)),
  decode: (b, meta) => {
    const data = JSON.parse(dec.decode(b));
    return meta !== void 0 ? { type: "raw", data, meta } : { type: "raw", data };
  }
};
var CSV_CODEC = {
  encode: (c) => enc.encode(c.data.map((f) => f.includes(",") || f.includes('"') ? `"${f.replace(/"/g, '""')}"` : f).join(",")),
  decode: (b, meta) => {
    const line = dec.decode(b);
    const data = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (ch === "," && !inQ) {
        data.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    data.push(cur);
    return meta !== void 0 ? { type: "csv", data, meta } : { type: "csv", data };
  }
};
var TEXT_CODECS = {
  json: JSON_CODEC,
  raw: RAW_CODEC,
  csv: CSV_CODEC,
  text: utf8Codec("text"),
  ndjson: utf8Codec("ndjson"),
  xml: utf8Codec("xml"),
  yaml: utf8Codec("yaml"),
  markdown: utf8Codec("markdown"),
  html: utf8Codec("html"),
  sql: utf8Codec("sql"),
  delta: utf8Codec("delta"),
  uuid: utf8Codec("uuid"),
  geojson: utf8Codec("geojson"),
  jwt: utf8Codec("jwt"),
  graphql: utf8Codec("graphql"),
  toml: utf8Codec("toml"),
  ini: utf8Codec("ini"),
  jsonschema: utf8Codec("jsonschema"),
  avroschema: utf8Codec("avroschema"),
  sourcemap: utf8Codec("sourcemap"),
  shader: utf8Codec("shader"),
  obj: utf8Codec("obj"),
  subtitle: utf8Codec("subtitle"),
  playlist: utf8Codec("playlist"),
  graphml: utf8Codec("graphml")
};

// src/mime.ts
var SYNC_SIGS = [
  [[255, 254], "text/plain"],
  [[254, 255], "text/plain"],
  [[239, 187, 191], "text/plain"],
  [[31, 139], "application/gzip"],
  [[80, 75, 3, 4], "application/zip"],
  [[137, 80, 78, 71], "image/png"],
  [[255, 216, 255], "image/jpeg"],
  [[71, 73, 70, 56], "image/gif"],
  [[37, 80, 68, 70], "application/pdf"]
];
function detectMime(data) {
  for (const [sig, mime] of SYNC_SIGS) {
    if (sig.every((b, i) => data[i] === b)) return mime;
  }
  if (data.length === 0) return "application/octet-stream";
  const sample = data.subarray(0, Math.min(64, data.length));
  let high = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] > 127) high++;
  if (high / sample.length > 0.3) return "application/octet-stream";
  const head2 = new TextDecoder("utf-8", { fatal: false }).decode(sample).trimStart();
  if (head2.startsWith("{") || head2.startsWith("[")) return "application/json";
  if (/^<\?xml/i.test(head2)) return "application/xml";
  if (/^<!DOCTYPE\s+html|^<html/i.test(head2)) return "text/html";
  return "text/plain";
}
async function detectFile(data) {
  if (data.length >= 2 && data[0] === 255 && data[1] === 254) {
    return { mime: "text/plain", ext: "txt", charset: "utf-16le", description: "utf-16le text" };
  }
  if (data.length >= 2 && data[0] === 254 && data[1] === 255) {
    return { mime: "text/plain", ext: "txt", charset: "utf-16be", description: "utf-16be text" };
  }
  if (typeof process !== "undefined" && process.versions?.node) {
    try {
      const spec = "file-type";
      const { fileTypeFromBuffer } = await import(
        /* @vite-ignore */
        spec
      );
      const r = await fileTypeFromBuffer(data);
      if (r) return { mime: r.mime, ext: r.ext };
    } catch {
    }
  }
  const mime = detectMime(data);
  const ext = MIME_TO_TYPE[mime] ?? void 0;
  return mime === "application/octet-stream" ? { mime } : { mime, ext: ext ?? "txt" };
}
var MIME_TO_TYPE = {
  "application/json": "json",
  "application/x-ndjson": "ndjson",
  "text/csv": "csv",
  "application/xml": "xml",
  "text/xml": "xml",
  "text/html": "html",
  "text/markdown": "markdown",
  "text/plain": "text",
  "application/x-yaml": "yaml",
  "application/yaml": "yaml",
  "application/sql": "sql",
  "image/jpeg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/bmp": "image",
  "image/tiff": "image",
  "image/avif": "image",
  "image/x-icon": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "video/mpeg": "video",
  "audio/mpeg": "audio",
  "audio/ogg": "audio",
  "audio/flac": "audio",
  "application/pdf": "pdf",
  "application/zip": "archive",
  "application/gzip": "archive",
  "application/x-bzip2": "archive",
  "application/x-xz": "archive",
  "application/x-7z-compressed": "archive",
  "application/x-rar-compressed": "archive",
  "application/wasm": "wasm",
  "application/vnd.apache.arrow.file": "arrow",
  "application/vnd.apache.parquet": "parquet"
};
function mimeToChunkType(mime) {
  return MIME_TO_TYPE[mime] ?? "binary";
}

// src/codec-binary.ts
var pass = (type) => {
  return {
    encode: (c) => c.data,
    decode: (b, meta) => {
      const mime = meta?.mime ?? detectMime(b);
      const m = meta !== void 0 ? { ...meta, mime } : { mime };
      return { type, data: b, meta: m };
    }
  };
};
var view = new DataView(new ArrayBuffer(8));
var fixedNum = (type, write, read) => {
  return {
    encode: (c) => write(c.data),
    decode: (b, meta) => {
      const data = read(b);
      return meta !== void 0 ? { type, data, meta } : { type, data };
    }
  };
};
var fixedBig = (type, write, read) => {
  return {
    encode: (c) => write(c.data),
    decode: (b, meta) => {
      const data = read(b);
      return meta !== void 0 ? { type, data, meta } : { type, data };
    }
  };
};
var u8w = (v) => new Uint8Array([Number(v) & 255]);
var u8r = (b) => b[0];
var i8w = (v) => {
  view.setInt8(0, Number(v));
  return Uint8Array.from(new Uint8Array(view.buffer, 0, 1));
};
var i8r = (b) => new DataView(b.buffer, b.byteOffset).getInt8(0);
var i16w = (v) => {
  view.setInt16(0, Number(v), true);
  return Uint8Array.from(new Uint8Array(view.buffer, 0, 2));
};
var i16r = (b) => new DataView(b.buffer, b.byteOffset).getInt16(0, true);
var u16w = (v) => {
  view.setUint16(0, Number(v), true);
  return Uint8Array.from(new Uint8Array(view.buffer, 0, 2));
};
var u16r = (b) => new DataView(b.buffer, b.byteOffset).getUint16(0, true);
var i32w = (v) => {
  view.setInt32(0, Number(v), true);
  return Uint8Array.from(new Uint8Array(view.buffer, 0, 4));
};
var i32r = (b) => new DataView(b.buffer, b.byteOffset).getInt32(0, true);
var u32w = (v) => {
  view.setUint32(0, Number(v), true);
  return Uint8Array.from(new Uint8Array(view.buffer, 0, 4));
};
var u32r = (b) => new DataView(b.buffer, b.byteOffset).getUint32(0, true);
var f32w = (v) => {
  view.setFloat32(0, Number(v), true);
  return Uint8Array.from(new Uint8Array(view.buffer, 0, 4));
};
var f32r = (b) => new DataView(b.buffer, b.byteOffset).getFloat32(0, true);
var f64w = (v) => {
  view.setFloat64(0, Number(v), true);
  return Uint8Array.from(new Uint8Array(view.buffer, 0, 8));
};
var f64r = (b) => new DataView(b.buffer, b.byteOffset).getFloat64(0, true);
var i64w = (v) => {
  view.setBigInt64(0, v, true);
  return Uint8Array.from(new Uint8Array(view.buffer, 0, 8));
};
var i64r = (b) => new DataView(b.buffer, b.byteOffset).getBigInt64(0, true);
var u64w = (v) => {
  view.setBigUint64(0, v, true);
  return Uint8Array.from(new Uint8Array(view.buffer, 0, 8));
};
var u64r = (b) => new DataView(b.buffer, b.byteOffset).getBigUint64(0, true);
var enc2 = new TextEncoder();
var dec2 = new TextDecoder();
var jsonHeaderCodec = (type, getHeader, getPayload, build) => ({
  encode: (c) => {
    const header = enc2.encode(JSON.stringify(getHeader(c)));
    const payload = getPayload(c);
    const hlen = new Uint8Array(4);
    new DataView(hlen.buffer).setUint32(0, header.length, false);
    const out = new Uint8Array(4 + header.length + payload.length);
    out.set(hlen, 0);
    out.set(header, 4);
    out.set(payload, 4 + header.length);
    return out;
  },
  decode: (b, meta) => {
    const hlen = new DataView(b.buffer, b.byteOffset).getUint32(0, false);
    const header = JSON.parse(dec2.decode(b.subarray(4, 4 + hlen)));
    return build(header, b.subarray(4 + hlen), meta);
  }
});
var EMBEDDING_CODEC = {
  encode: (c) => new Uint8Array(c.data.buffer, c.data.byteOffset, c.data.byteLength),
  decode: (b, meta) => {
    const data = new Float32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
    return meta !== void 0 ? { type: "embedding", data, meta } : { type: "embedding", data };
  }
};
var NULL_CODEC = {
  encode: () => new Uint8Array(0),
  decode: (_, meta) => meta !== void 0 ? { type: "null", data: null, meta } : { type: "null", data: null }
};
var COMPLEX_CODEC = (type, fw, fr) => {
  const sz = fw(0).length;
  return {
    encode: (c) => {
      const d = c;
      const out = new Uint8Array(sz * 2);
      out.set(fw(d.data.re), 0);
      out.set(fw(d.data.im), sz);
      return out;
    },
    decode: (b, meta) => {
      const data = { re: fr(b, 0), im: fr(b, sz) };
      return meta !== void 0 ? { type, data, meta } : { type, data };
    }
  };
};
var BINARY_CODECS = {
  binary: pass("binary"),
  image: pass("image"),
  video: pass("video"),
  audio: pass("audio"),
  pdf: pass("pdf"),
  archive: pass("archive"),
  protobuf: pass("protobuf"),
  msgpack: pass("msgpack"),
  cbor: pass("cbor"),
  arrow: pass("arrow"),
  parquet: pass("parquet"),
  wasm: pass("wasm"),
  font: pass("font"),
  onnx: pass("onnx"),
  safetensors: pass("safetensors"),
  epub: pass("epub"),
  docx: pass("docx"),
  xlsx: pass("xlsx"),
  pptx: pass("pptx"),
  gltf: pass("gltf"),
  qrcode: pass("qrcode"),
  dns: pass("dns"),
  dhcp: pass("dhcp"),
  icmp: pass("icmp"),
  embedding: EMBEDDING_CODEC,
  null: NULL_CODEC,
  frame: jsonHeaderCodec(
    "frame",
    (c) => ({ width: c.data.width, height: c.data.height, format: c.data.format }),
    (c) => c.data.data,
    (h, p, m) => {
      const hh = h;
      const data = { ...hh, data: p };
      return m !== void 0 ? { type: "frame", data, meta: m } : { type: "frame", data };
    }
  ),
  multipart: jsonHeaderCodec(
    "multipart",
    (c) => ({ name: c.data.name, filename: c.data.filename, contentType: c.data.contentType }),
    (c) => c.data.data,
    (h, p, m) => {
      const hh = h;
      const mime = detectMime(p);
      const data = { ...hh, data: p };
      const mm = m !== void 0 ? { ...m, mime } : { mime };
      return { type: "multipart", data, meta: mm };
    }
  ),
  ciphertext: jsonHeaderCodec(
    "ciphertext",
    (c) => ({ algo: c.data.algo, iv: Array.from(c.data.iv) }),
    (c) => c.data.data,
    (h, p, m) => {
      const hh = h;
      const data = { algo: hh.algo, iv: new Uint8Array(hh.iv), data: p };
      return m !== void 0 ? { type: "ciphertext", data, meta: m } : { type: "ciphertext", data };
    }
  ),
  signature: jsonHeaderCodec(
    "signature",
    (c) => ({ algo: c.data.algo }),
    (c) => c.data.data,
    (h, p, m) => {
      const hh = h;
      const data = { algo: hh.algo, data: p };
      return m !== void 0 ? { type: "signature", data, meta: m } : { type: "signature", data };
    }
  ),
  hmac: jsonHeaderCodec(
    "hmac",
    (c) => ({ algo: c.data.algo }),
    (c) => c.data.data,
    (h, p, m) => {
      const hh = h;
      const data = { algo: hh.algo, data: p };
      return m !== void 0 ? { type: "hmac", data, meta: m } : { type: "hmac", data };
    }
  ),
  keypair: jsonHeaderCodec(
    "keypair",
    (c) => ({ algo: c.data.algo, privateKey: c.data.privateKey ? Array.from(c.data.privateKey) : void 0 }),
    (c) => c.data.publicKey,
    (h, p, m) => {
      const hh = h;
      const data = { algo: hh.algo, publicKey: p, ...hh.privateKey !== void 0 ? { privateKey: new Uint8Array(hh.privateKey) } : {} };
      return m !== void 0 ? { type: "keypair", data, meta: m } : { type: "keypair", data };
    }
  ),
  certificate: jsonHeaderCodec(
    "certificate",
    (c) => ({ format: c.data.format }),
    (c) => c.data.data,
    (h, p, m) => {
      const hh = h;
      const data = { format: hh.format, data: p };
      return m !== void 0 ? { type: "certificate", data, meta: m } : { type: "certificate", data };
    }
  ),
  tensor: jsonHeaderCodec(
    "tensor",
    (c) => ({ shape: c.data.shape, dtype: c.data.dtype }),
    (c) => c.data.data,
    (h, p, m) => {
      const hh = h;
      const data = { shape: hh.shape, dtype: hh.dtype, data: p };
      return m !== void 0 ? { type: "tensor", data, meta: m } : { type: "tensor", data };
    }
  ),
  pointcloud: jsonHeaderCodec(
    "pointcloud",
    (c) => ({ fields: c.data.fields }),
    (c) => new Uint8Array(c.data.points.buffer, c.data.points.byteOffset, c.data.points.byteLength),
    (h, p, m) => {
      const hh = h;
      const points = new Float32Array(p.buffer.slice(p.byteOffset, p.byteOffset + p.byteLength));
      const data = { points, ...hh.fields !== void 0 ? { fields: hh.fields } : {} };
      return m !== void 0 ? { type: "pointcloud", data, meta: m } : { type: "pointcloud", data };
    }
  ),
  webtransport: jsonHeaderCodec(
    "webtransport",
    (c) => ({ sessionId: c.data.sessionId, streamId: c.data.streamId }),
    (c) => c.data.data,
    (h, p, m) => {
      const hh = h;
      const data = { sessionId: hh.sessionId, data: p, ...hh.streamId !== void 0 ? { streamId: hh.streamId } : {} };
      return m !== void 0 ? { type: "webtransport", data, meta: m } : { type: "webtransport", data };
    }
  ),
  uint8: fixedNum("uint8", u8w, u8r),
  int8: fixedNum("int8", i8w, i8r),
  int16: fixedNum("int16", i16w, i16r),
  uint16: fixedNum("uint16", u16w, u16r),
  int32: fixedNum("int32", i32w, i32r),
  uint32: fixedNum("uint32", u32w, u32r),
  float32: fixedNum("float32", f32w, f32r),
  float64: fixedNum("float64", f64w, f64r),
  bool: fixedNum("bool", (v) => u8w(v ? 1 : 0), (b) => u8r(b) !== 0),
  timestamp: fixedNum("timestamp", f64w, f64r),
  int64: fixedBig("int64", i64w, i64r),
  uint64: fixedBig("uint64", u64w, u64r),
  complex64: COMPLEX_CODEC("complex64", f32w, (b, o) => new DataView(b.buffer, b.byteOffset).getFloat32(o, true)),
  complex128: COMPLEX_CODEC("complex128", f64w, (b, o) => new DataView(b.buffer, b.byteOffset).getFloat64(o, true))
};

// src/codec-structured.ts
var enc3 = new TextEncoder();
var dec3 = new TextDecoder();
var jsonCodec = (type) => {
  return {
    encode: (c) => enc3.encode(JSON.stringify(c.data)),
    decode: (b, meta) => {
      const data = JSON.parse(dec3.decode(b));
      return meta !== void 0 ? { type, data, meta } : { type, data };
    }
  };
};
var SSE_CODEC = {
  encode: (c) => {
    const parts = [];
    if (c.data.event !== void 0) parts.push(`event: ${c.data.event}`);
    if (c.data.id !== void 0) parts.push(`id: ${c.data.id}`);
    parts.push(`data: ${c.data.data}`);
    return enc3.encode(parts.join("\n") + "\n\n");
  },
  decode: (b, meta) => {
    const data = {};
    for (const line of dec3.decode(b).split("\n")) {
      if (line.startsWith("data: ")) data.data = line.slice(6);
      else if (line.startsWith("event: ")) data.event = line.slice(7);
      else if (line.startsWith("id: ")) data.id = line.slice(4);
    }
    if (data.data === void 0) throw new Error(`sse decode: missing data field in: ${dec3.decode(b).slice(0, 80)}`);
    const msg = { data: data.data };
    if (data.event !== void 0) msg.event = data.event;
    if (data.id !== void 0) msg.id = data.id;
    return meta !== void 0 ? { type: "sse", data: msg, meta } : { type: "sse", data: msg };
  }
};
var STRUCTURED_CODECS = {
  "http-request": jsonCodec("http-request"),
  "http-response": jsonCodec("http-response"),
  "websocket": jsonCodec("websocket"),
  "token": jsonCodec("token"),
  "error": jsonCodec("error"),
  "signal": jsonCodec("signal"),
  "rpc": jsonCodec("rpc"),
  "event": jsonCodec("event"),
  "span": jsonCodec("span"),
  "metric": jsonCodec("metric"),
  "log": jsonCodec("log"),
  "command": jsonCodec("command"),
  "patch": jsonCodec("patch"),
  "socketio": jsonCodec("socketio"),
  "envelope": jsonCodec("envelope"),
  "ack": jsonCodec("ack"),
  "nack": jsonCodec("nack"),
  "ast": jsonCodec("ast"),
  "hash": jsonCodec("hash"),
  "timeseries": jsonCodec("timeseries"),
  "ohlcv": jsonCodec("ohlcv"),
  "adjacency": jsonCodec("adjacency"),
  "sse": SSE_CODEC
};

// src/codec.ts
var CODECS = {
  ...TEXT_CODECS,
  ...BINARY_CODECS,
  ...STRUCTURED_CODECS
};
function encodeChunk(chunk) {
  return CODECS[chunk.type].encode(chunk);
}
function decodeChunk(type, bytes, meta) {
  return CODECS[type].decode(bytes, meta);
}

// node_modules/sflow/dist/skips-o3ebh_7B.js
function chunkIfs(predicate, { inclusive = false } = {}) {
  const chunks2 = [];
  let i = 0;
  return new TransformStream({
    transform: async (chunk, ctrl) => {
      const cond = await predicate(chunk, i++, chunks2);
      if (!inclusive && !cond) {
        if (chunks2.length) ctrl.enqueue(chunks2.splice(0, Infinity));
      }
      chunks2.push(chunk);
      if (!cond) ctrl.enqueue(chunks2.splice(0, Infinity));
    },
    flush: async (ctrl) => {
      if (chunks2.length) ctrl.enqueue(chunks2);
    }
  });
}
function maps(fn, options) {
  const concurrency = options?.concurrency ?? 1;
  if (concurrency === 1) {
    let i2 = 0;
    return new TransformStream({ transform: async (chunk, ctrl) => {
      const ret = fn(chunk, i2++);
      const val = ret instanceof Promise ? await ret : ret;
      ctrl.enqueue(val);
    } });
  }
  let i = 0;
  const promises = [];
  return new TransformStream({
    transform: async (chunk, ctrl) => {
      promises.push(fn(chunk, i++));
      if (promises.length >= concurrency) ctrl.enqueue(await promises.shift());
    },
    flush: async (ctrl) => {
      while (promises.length) ctrl.enqueue(await promises.shift());
    }
  });
}
function flatMaps(fn) {
  let i = 0;
  return new TransformStream({ transform: async (chunk, ctrl) => {
    const ret = fn(chunk, i++);
    (ret instanceof Promise ? await ret : ret).map((e) => ctrl.enqueue(e));
  } });
}
var throughs = (arg) => {
  if (!arg) return new TransformStream();
  if (typeof arg !== "function") return throughs((s) => s.pipeThrough(arg));
  const fn = arg;
  const { writable, readable } = new TransformStream();
  return {
    writable,
    readable: fn(readable)
  };
};
var lines = ({ EOL = "KEEP" } = {}) => {
  const CRLFMap = {
    KEEP: "$1",
    LF: "\n",
    CRLF: "\r\n",
    NONE: ""
  };
  return throughs((r) => r.pipeThrough(flatMaps((s) => s.split(/(?<=\n)/g))).pipeThrough(chunkIfs((ch) => ch.indexOf("\n") === -1, { inclusive: true })).pipeThrough(maps((chunks2) => chunks2.join("").replace(/(\r?\n?)$/, CRLFMap[EOL]))));
};
function skips(n = 1) {
  return new TransformStream({ transform: async (chunk, ctrl) => {
    if (n <= 0) ctrl.enqueue(chunk);
    else n--;
  } });
}

// node_modules/phpdie/dist/index.js
var phpdie_default = DIE;
function DIE(reason, ...slots) {
  throw errorFormat(reason, ...slots);
}
function errorFormat(reason, ...slots) {
  if (typeof reason === "string") {
    return reason.trim();
  }
  if (Array.isArray(reason)) {
    return reason.map((e, i) => e + (slots[i] ?? "")).join("");
  }
  return reason;
}

// node_modules/web-streams-extensions/dist/esm/_readable-like.js
function isReadableLike(obj2) {
  return obj2 && typeof obj2 === "object" && "readable" in obj2 && obj2.readable instanceof ReadableStream;
}

// node_modules/web-streams-extensions/dist/esm/from.js
function from(src) {
  let it;
  let isAsyncIterator = false;
  async function flush(controller) {
    try {
      if (isAsyncIterator) {
        while (controller.desiredSize > 0 && it != null) {
          let next = await it.next();
          if (next.done) {
            it = null;
            controller.close();
            break;
          } else {
            controller.enqueue(next.value);
          }
        }
      } else {
        while (it != null) {
          let next = it.next();
          if (next.done) {
            it = null;
            controller.close();
            break;
          } else {
            controller.enqueue(next.value);
          }
        }
      }
    } catch (err) {
      controller.error(err);
      it = null;
    }
  }
  if (isReadableLike(src)) {
    return src.readable;
  }
  return new ReadableStream({
    async start(controller) {
      try {
        let iterable;
        if (typeof src == "function") {
          src = src();
        }
        if (Symbol.asyncIterator && src[Symbol.asyncIterator]) {
          iterable = src[Symbol.asyncIterator].bind(src);
          isAsyncIterator = true;
        } else if (src[Symbol.iterator]) {
          iterable = src[Symbol.iterator].bind(src);
          isAsyncIterator = false;
        } else {
          let value = await Promise.resolve(src);
          controller.enqueue(value);
          controller.close();
          return;
        }
        it = iterable();
        return flush(controller);
      } catch (err) {
        controller.error(err);
      }
    },
    async pull(controller) {
      return flush(controller);
    },
    async cancel(reason) {
      if (it) {
        try {
          if (reason && it.throw) {
            await it.throw(reason);
          } else if (it.return) {
            await it.return();
          }
        } catch (err) {
        } finally {
          it = null;
        }
      }
    }
  });
}

// node_modules/web-streams-extensions/dist/esm/operators/through.js
function through(dst) {
  return function(src, strategy = { highWaterMark: 16 }) {
    if (!dst || typeof dst.readable === "undefined" || typeof dst.writable === "undefined") {
      throw new Error("Invalid TransformStream provided to through operator");
    }
    return src.pipeThrough(dst);
  };
}

// node_modules/web-streams-extensions/dist/esm/utils/is-transform.js
function isTransform(x) {
  return x && typeof x === "object" && "readable" in x && "writable" in x;
}

// node_modules/web-streams-extensions/dist/esm/pipe.js
function pipe(src, ...args) {
  if (isReadableLike(src)) {
    src = src.readable;
  }
  let options = { highWaterMark: 16 };
  let operators = args;
  const lastArg = args[args.length - 1];
  if (lastArg && typeof lastArg === "object" && !lastArg.readable && !lastArg.writable && typeof lastArg.pipeThrough !== "function" && (lastArg.highWaterMark !== void 0 || lastArg.size !== void 0)) {
    options = { ...options, ...lastArg };
    operators = args.slice(0, -1);
  }
  return operators.map((x) => isTransform(x) ? through(x) : x).reduce((stream, operator) => {
    return operator(stream, options);
  }, src);
}

// node_modules/web-streams-extensions/dist/esm/operators/map.js
function map(select) {
  let reader = null;
  let index = 0;
  async function flush(controller) {
    try {
      while (controller.desiredSize > 0 && reader != null) {
        let next = await reader.read();
        if (next.done) {
          controller.close();
          if (reader) {
            reader.releaseLock();
            reader = null;
          }
        } else {
          let mapped = await select(next.value, index++);
          if (mapped !== void 0)
            controller.enqueue(mapped);
        }
      }
    } catch (err) {
      controller.error(err);
      if (reader) {
        try {
          await reader.cancel(err);
          reader.releaseLock();
        } catch (e) {
        }
        reader = null;
      }
    }
  }
  return function(src, strategy = { highWaterMark: 16 }) {
    return new ReadableStream({
      start(controller) {
        reader = src.getReader();
        return flush(controller);
      },
      pull(controller) {
        return flush(controller);
      },
      cancel(reason) {
        if (reader) {
          try {
            reader.cancel(reason).catch(() => {
            });
            reader.releaseLock();
          } catch (err) {
          } finally {
            reader = null;
          }
        }
      }
    }, strategy);
  };
}

// node_modules/web-streams-extensions/dist/esm/utils/signal.js
var Gate = class {
  _count;
  _queue = [];
  /**
   * Create a new Gate with the specified initial count.
   * @param _count The initial number of operations that can proceed immediately
   */
  constructor(_count) {
    this._count = _count;
  }
  /**
   * Wait for permission to proceed. If count > 0, returns immediately.
   * Otherwise, waits until increment() is called.
   * @returns A promise that resolves when permission is granted
   */
  async wait() {
    if (this._count > 0) {
      --this._count;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const callback = () => {
        const index = this._queue.indexOf(callback);
        if (index !== -1) {
          this._queue.splice(index, 1);
        }
        --this._count;
        resolve();
      };
      this._queue.push(callback);
    });
  }
  /**
   * Increment the count, potentially allowing queued operations to proceed.
   */
  increment() {
    ++this._count;
    this.clearQueue();
  }
  /**
   * Set the count to a specific value and clear any waiting operations.
   * @param count The new count value
   */
  setCount(count) {
    this._count = count;
    this.clearQueue();
  }
  /**
   * Get the current count.
   * @returns The current count
   */
  get count() {
    return this._count;
  }
  /**
   * Get the number of operations waiting in the queue.
   * @returns The queue length
   */
  get queueLength() {
    return this._queue.length;
  }
  clearQueue() {
    while (this._count > 0 && this._queue.length > 0) {
      const callback = this._queue.shift();
      if (callback) {
        try {
          callback();
        } catch (err) {
          console.error("Error in gate callback:", err);
        }
      }
    }
  }
};
var BlockingQueue = class {
  _pushers = [];
  _pullers = [];
  constructor() {
  }
  /**
   * Push a value to the queue. If no puller is waiting, this will block
   * until a puller calls pull().
   * @param value The value to push
   * @returns A promise that resolves when the value has been delivered
   */
  async push(value) {
    return new Promise((resolve) => {
      this._pushers.unshift(() => {
        resolve();
        return value;
      });
      this.dequeue();
    });
  }
  /**
   * Pull a value from the queue. If no pusher is waiting, this will block
   * until a pusher calls push().
   * @returns A promise that resolves with the pulled value
   */
  async pull() {
    return new Promise((resolve) => {
      this._pullers.unshift((value) => {
        resolve(value);
      });
      this.dequeue();
    });
  }
  /**
   * Get the number of pushers waiting to deliver values.
   * @returns The number of waiting pushers
   */
  get pushersWaiting() {
    return this._pushers.length;
  }
  /**
   * Get the number of pullers waiting for values.
   * @returns The number of waiting pullers
   */
  get pullersWaiting() {
    return this._pullers.length;
  }
  dequeue() {
    while (this._pullers.length > 0 && this._pushers.length > 0) {
      const puller = this._pullers.pop();
      const pusher = this._pushers.pop();
      if (puller && pusher) {
        try {
          const value = pusher();
          puller(value);
        } catch (err) {
          console.error("Error in blocking queue dequeue:", err);
        }
      }
    }
  }
};

// node_modules/web-streams-extensions/dist/esm/operators/schedule.js
function schedule(scheduler) {
  let reader = null;
  async function flush(controller) {
    try {
      while (controller.desiredSize > 0 && reader != null) {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          if (reader) {
            reader.releaseLock();
            reader = null;
          }
          return;
        } else {
          try {
            await new Promise((resolve) => {
              scheduler.schedule(resolve);
            });
            controller.enqueue(next.value);
          } catch (err) {
            controller.error(err);
            return;
          }
        }
      }
    } catch (err) {
      controller.error(err);
      if (reader) {
        try {
          await reader.cancel(err);
          reader.releaseLock();
        } catch (e) {
        }
        reader = null;
      }
    }
  }
  return function(src, strategy = { highWaterMark: 16 }) {
    if (!scheduler || typeof scheduler.schedule !== "function") {
      throw new Error("Invalid scheduler provided to schedule operator");
    }
    return new ReadableStream({
      start(controller) {
        reader = src.getReader();
        return flush(controller);
      },
      pull(controller) {
        return flush(controller);
      },
      cancel(reason) {
        if (reader) {
          try {
            reader.cancel(reason).catch(() => {
            });
            reader.releaseLock();
          } catch (err) {
          } finally {
            reader = null;
          }
        }
      }
    }, strategy);
  };
}

// node_modules/web-streams-extensions/dist/esm/operators/on.js
function on(callbacks) {
  let reader = null;
  let cancelled = false;
  async function flush(controller) {
    try {
      while (controller.desiredSize > 0 && reader != null && !cancelled) {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          if (reader) {
            reader.releaseLock();
            reader = null;
          }
          if (!cancelled && callbacks.complete) {
            try {
              callbacks.complete();
            } catch (err) {
              console.error("Error in complete callback:", err);
            }
          }
        } else {
          controller.enqueue(next.value);
        }
      }
    } catch (err) {
      controller.error(err);
      if (reader) {
        try {
          await reader.cancel(err);
          reader.releaseLock();
        } catch (e) {
        }
        reader = null;
      }
      if (!cancelled && callbacks.error) {
        try {
          callbacks.error(err);
        } catch (callbackErr) {
          console.error("Error in error callback:", callbackErr);
        }
      }
    }
  }
  return function(src, strategy = { highWaterMark: 16 }) {
    return new ReadableStream({
      start(controller) {
        reader = src.getReader();
        if (callbacks.start) {
          try {
            callbacks.start();
          } catch (err) {
            console.error("Error in start callback:", err);
          }
        }
        return flush(controller);
      },
      pull(controller) {
        return flush(controller);
      },
      cancel(reason) {
        cancelled = true;
        if (reader) {
          try {
            reader.cancel(reason).catch(() => {
            });
            reader.releaseLock();
          } catch (err) {
          } finally {
            reader = null;
          }
        }
        if (callbacks.cancel) {
          try {
            callbacks.cancel(reason);
          } catch (err) {
            console.error("Error in cancel callback:", err);
          }
        }
      }
    }, strategy);
  };
}

// node_modules/web-streams-extensions/dist/esm/to-promise.js
async function toPromise(src) {
  let res = void 0;
  if (isReadableLike(src)) {
    src = src.readable;
  }
  let reader = src.getReader();
  try {
    let done = false;
    while (done == false) {
      let next = await reader.read();
      done = next.done;
      if (!done)
        res = next.value;
    }
  } finally {
    try {
      await reader.cancel();
    } catch (e) {
    }
    reader.releaseLock();
  }
  return res;
}

// node_modules/web-streams-extensions/dist/esm/operators/mergeMap.js
function mergeMap(project, concurrent = Infinity) {
  if (concurrent <= 0) {
    throw new Error("Concurrency limit must be greater than zero");
  }
  return function(src, strategy = { highWaterMark: 16 }) {
    const outerGate = new Gate(concurrent);
    const innerQueue = new BlockingQueue();
    const abortControllers = /* @__PURE__ */ new Set();
    let errored = null;
    return new ReadableStream({
      start(outerController) {
        let reading = [];
        let readingDone = false;
        let index = 0;
        toPromise(pipe(
          src,
          // Block here until a concurrency slot is available
          schedule({
            schedule: (callback) => {
              outerGate.wait().then(callback);
            }
          }),
          // After a slot is reserved, invoke the projector and wire the resulting inner
          map(async (value) => {
            const currentIndex = index++;
            const abortController = new AbortController();
            abortControllers.add(abortController);
            let readableStream = null;
            try {
              const projected = await project(value, currentIndex, abortController.signal);
              if (projected instanceof ReadableStream) {
                readableStream = projected;
              } else {
                readableStream = from(projected);
              }
            } catch (err) {
              outerGate.increment();
              throw err;
            } finally {
              abortControllers.delete(abortController);
            }
            reading.push(readableStream);
            pipe(readableStream, map(async (innerValue) => {
              try {
                await innerQueue.push({ done: false, value: innerValue });
              } catch (err) {
                outerController.error(err);
              }
            }), on({
              error(err) {
                errored = err;
                outerController.error(err);
                outerGate.increment();
              },
              complete() {
                outerGate.increment();
                const idx = reading.indexOf(readableStream);
                if (idx !== -1)
                  reading.splice(idx, 1);
                if (reading.length === 0 && readingDone) {
                  try {
                    innerQueue.push({ done: true, value: void 0 });
                  } catch (err) {
                    outerController.error(err);
                  }
                }
              }
            }));
          }),
          on({
            error(err) {
              errored = err;
              outerController.error(err);
            },
            complete() {
              readingDone = true;
              if (reading.length === 0) {
                try {
                  innerQueue.push({ done: true, value: void 0 });
                } catch (err) {
                  outerController.error(err);
                }
              }
            }
          })
        )).catch((err) => {
          errored = err;
          outerController.error(err);
        });
      },
      async pull(controller) {
        try {
          while (controller.desiredSize > 0 && !errored) {
            const next = await innerQueue.pull();
            if (errored) {
              controller.error(errored);
              return;
            }
            if (next.done) {
              controller.close();
              return;
            } else {
              controller.enqueue(next.value);
            }
          }
        } catch (err) {
          controller.error(err);
        }
      },
      cancel(reason) {
        for (const ac of abortControllers) {
          try {
            ac.abort(reason);
          } catch {
          }
        }
        abortControllers.clear();
      }
    }, strategy);
  };
}

// node_modules/web-streams-extensions/dist/esm/operators/mergeAll.js
function mergeAll(concurrent = Infinity) {
  if (concurrent <= 0) {
    throw new Error("Concurrency limit must be greater than zero");
  }
  const project = (v) => v;
  const op = mergeMap(project, concurrent);
  return (src, strategy = { highWaterMark: 16 }) => op(src, strategy);
}

// node_modules/web-streams-extensions/dist/esm/to-array.js
async function toArray(src) {
  let res = [];
  if (isReadableLike(src)) {
    src = src.readable;
  }
  let reader = src.getReader();
  try {
    let done = false;
    while (done == false) {
      let next = await reader.read();
      done = next.done;
      if (!done)
        res.push(next.value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch (e) {
    }
    reader.releaseLock();
  }
  return res;
}

// node_modules/string-replace-async/index.js
function replaceAsync(string, searchValue, replacer) {
  try {
    if (typeof replacer === "function") {
      var values = [];
      String.prototype.replace.call(string, searchValue, function() {
        values.push(replacer.apply(void 0, arguments));
        return "";
      });
      return Promise.all(values).then(function(resolvedValues) {
        return String.prototype.replace.call(string, searchValue, function() {
          return resolvedValues.shift();
        });
      });
    } else {
      return Promise.resolve(
        String.prototype.replace.call(string, searchValue, replacer)
      );
    }
  } catch (error2) {
    return Promise.reject(error2);
  }
}

// node_modules/sflow/dist/index.js
var import_unwind_array = __toESM(require_src(), 1);
var asyncMaps = (fn, options = {}) => {
  let i = 0;
  const tasks = /* @__PURE__ */ new Map();
  return new TransformStream({
    transform: async (chunk, ctrl) => {
      const id = i++;
      tasks.set(id, (async () => fn(chunk, id))().then((data) => ({
        id,
        data
      })));
      if (tasks.size >= (options.concurrency ?? 16)) {
        const { id: id2, data } = await Promise.race(tasks.values());
        tasks.delete(id2);
        ctrl.enqueue(data);
      }
    },
    flush: async (ctrl) => {
      while (tasks.size) {
        const { id, data } = await Promise.race(tasks.values());
        tasks.delete(id);
        ctrl.enqueue(data);
      }
    }
  });
};
var _never = new Promise(() => {
});
var never = () => _never;
function cacheLists(store, _options) {
  const { key = (/* @__PURE__ */ new Error()).stack ?? phpdie_default("missing cache key") } = typeof _options === "string" ? { key: _options } : _options ?? {};
  const chunks2 = [];
  const cacheHitPromise = store.has?.(key) || store.get(key);
  let hitflag = false;
  return new TransformStream({
    start: async (ctrl) => {
      if (!await cacheHitPromise) return;
      const cached = await store.get(key);
      if (!cached) return;
      cached.map((c) => ctrl.enqueue(c));
      hitflag = true;
    },
    transform: async (chunk, ctrl) => {
      if (await cacheHitPromise || hitflag) {
        ctrl.terminate();
        return never();
      }
      chunks2.push(chunk);
      ctrl.enqueue(chunk);
    },
    flush: async () => await store.set(key, chunks2)
  });
}
function cacheSkips(store, _options) {
  const { key = (/* @__PURE__ */ new Error()).stack ?? phpdie_default("missing cache key"), windowSize = 1 } = typeof _options === "string" ? { key: _options } : _options ?? {};
  const chunks2 = [];
  const cachePromise = store.get(key);
  return new TransformStream({
    transform: async (chunk, ctrl) => {
      const cache = await cachePromise;
      const chunked = JSON.stringify(chunk);
      const inf404 = (idx) => idx == null || idx < 0 ? Infinity : idx;
      const hitCache = (item) => JSON.stringify(item) === chunked;
      const cachedContents = cache?.slice(inf404(cache.findIndex(hitCache)));
      if (cachedContents?.length) {
        await store.set(key, [...chunks2, ...cachedContents].slice(0, windowSize));
        ctrl.terminate();
        return await never();
      }
      chunks2.push(chunk);
      ctrl.enqueue(chunk);
    },
    flush: async () => {
      await store.set(key, chunks2.slice(0, windowSize));
    }
  });
}
function minBy(fn, arr) {
  let min = arr[0];
  for (let i = 1; i < arr.length; i++) if (fn(arr[i]) < fn(min)) min = arr[i];
  return min;
}
function maxBy(fn, arr) {
  let max = arr[0];
  for (let i = 1; i < arr.length; i++) if (fn(arr[i]) > fn(max)) max = arr[i];
  return max;
}
function deepEquals(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEquals(v, b[i]));
  }
  if (typeof a === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEquals(a[k], b[k]));
  }
  return false;
}
function cacheTails(store, _options) {
  const { key = (/* @__PURE__ */ new Error()).stack ?? phpdie_default("missing cache key") } = typeof _options === "string" ? { key: _options } : _options ?? {};
  const chunks2 = [];
  const cachePromise = Promise.withResolvers();
  const t = new TransformStream();
  const w = t.writable.getWriter();
  return {
    writable: new WritableStream({
      start: async () => cachePromise.resolve(await store.get(key) ?? []),
      write: async (chunk, ctrl) => {
        const cache = await cachePromise.promise;
        if (cache && deepEquals(chunk, cache[0])) {
          await store.set(key, [...chunks2, ...cache]);
          for await (const item of cache) await w.write(item);
          await w.close();
          ctrl.error(/* @__PURE__ */ new Error("cached"));
          return await never();
        }
        chunks2.push(chunk);
        await w.write(chunk);
      },
      close: async () => {
        await store.set(key, [...chunks2]);
        await w.close();
      },
      abort: () => w.abort()
    }),
    readable: t.readable
  };
}
function chunkBys(compareFn) {
  const chunks2 = [];
  let lastOrder;
  return new TransformStream({
    transform: async (chunk, ctrl) => {
      const order = await compareFn(chunk);
      if (lastOrder && lastOrder !== order) ctrl.enqueue(chunks2.splice(0, Infinity));
      chunks2.push(chunk);
      lastOrder = order;
    },
    flush: async (ctrl) => void (chunks2.length && ctrl.enqueue(chunks2))
  });
}
function chunkIntervals(interval = 0) {
  const chunks2 = [];
  let id = null;
  return new TransformStream({
    start: (ctrl) => {
      id = setInterval(() => ctrl.enqueue(chunks2.splice(0, Infinity)), interval);
    },
    transform: async (chunk) => {
      chunks2.push(chunk);
    },
    flush: async (ctrl) => {
      if (chunks2.length) ctrl.enqueue(chunks2.splice(0, Infinity));
      if (id !== null) clearInterval(id);
    }
  });
}
function chunks(n = Infinity) {
  const chunks2 = [];
  if (n <= 0) throw new Error("Buffer size must be greater than 0");
  return new TransformStream({
    transform: async (chunk, ctrl) => {
      chunks2.push(chunk);
      if (chunks2.length >= n) ctrl.enqueue(chunks2.splice(0, Infinity));
    },
    flush: async (ctrl) => void (chunks2.length && ctrl.enqueue(chunks2))
  });
}
var toStream = (src) => src instanceof ReadableStream ? src : from(src ?? []);
function nils() {
  return new WritableStream();
}
var concats = (srcs) => {
  if (!srcs) return new TransformStream();
  const upstream = new TransformStream();
  return {
    writable: upstream.writable,
    readable: concatStream([upstream.readable, concatStream(srcs)])
  };
};
var concatStream = (srcs) => {
  if (!srcs) return new ReadableStream({ start: (c) => c.close() });
  const t = new TransformStream();
  const w = t.writable.getWriter();
  toStream(srcs).pipeThrough(maps(toStream)).pipeThrough(maps(async (s) => {
    const r = s.getReader();
    while (true) {
      const { value, done } = await r.read();
      if (done) break;
      await w.write(value);
    }
  })).pipeTo(nils()).then(() => w.close()).catch((reason) => w.abort(reason));
  return t.readable;
};
var confluences = ({ order = "breadth" } = {}) => {
  if (order !== "breadth") phpdie_default("not implemented");
  const { writable, readable: sources } = new TransformStream();
  const srcsQueue = [];
  return {
    writable,
    readable: new ReadableStream({ async pull(ctrl) {
      while (true) {
        const src = await (async () => {
          const r2 = sources.getReader();
          const { done: done2, value: src2 } = await r2.read();
          r2.releaseLock();
          if (done2) return srcsQueue.shift();
          return src2;
        })();
        if (!src) return ctrl.close();
        const r = src.getReader();
        const { done, value } = await r.read();
        r.releaseLock();
        if (done) continue;
        srcsQueue.push(src);
        ctrl.enqueue(value);
        return;
      }
    } })
  };
};
function convolves(n) {
  const buffer = [];
  return new TransformStream({
    transform(chunk, controller) {
      buffer.push(chunk);
      if (buffer.length > n) buffer.shift();
      if (buffer.length === n) controller.enqueue([...buffer]);
    },
    flush(controller) {
      while (buffer.length > 1) {
        buffer.shift();
        if (buffer.length === n) controller.enqueue([...buffer]);
      }
    }
  });
}
function debounces(t) {
  let id = null;
  return new TransformStream({
    transform: async (chunk, ctrl) => {
      if (id) clearTimeout(id);
      id = setTimeout(() => {
        ctrl.enqueue(chunk);
        id = null;
      }, t);
    },
    flush: async () => {
      while (id) await new Promise((r) => setTimeout(r, t / 2));
    }
  });
}
var filters = (fn) => {
  let i = 0;
  return new TransformStream({ transform: async (chunk, ctrl) => {
    if (fn) {
      if (await fn(chunk, i++)) ctrl.enqueue(chunk);
    } else if (!(void 0 === chunk || null === chunk)) ctrl.enqueue(chunk);
  } });
};
function finds(predicate) {
  let index = 0;
  let found = false;
  return new TransformStream({ async transform(chunk, controller) {
    if (found) return;
    if (await predicate(chunk, index++)) {
      found = true;
      controller.enqueue(chunk);
      controller.terminate();
    }
  } });
}
function flats() {
  return composers(filters((e) => e.length)).by(new TransformStream({ transform: async (a, ctrl) => {
    a.map((e) => ctrl.enqueue(e));
  } }));
}
function forEachs(fn, options) {
  const concurrency = options?.concurrency ?? 1;
  if (concurrency === 1) {
    let i2 = 0;
    return new TransformStream({ transform: async (chunk, ctrl) => {
      const ret = fn(chunk, i2++);
      if (ret instanceof Promise) await ret;
      ctrl.enqueue(chunk);
    } });
  }
  let i = 0;
  const promises = [];
  const chunks2 = [];
  return new TransformStream({
    transform: async (chunk, ctrl) => {
      promises.push(fn(chunk, i++));
      chunks2.push(chunk);
      if (promises.length >= concurrency) {
        await promises.shift();
        const chunk2 = chunks2.shift();
        if (chunk2 === void 0) throw new Error("chunks.shift() returned undefined");
        ctrl.enqueue(chunk2);
      }
    },
    flush: async (ctrl) => {
      while (promises.length) {
        await promises.shift();
        const chunk = chunks2.shift();
        if (chunk === void 0) throw new Error("chunks.shift() returned undefined");
        ctrl.enqueue(chunk);
      }
    }
  });
}
function heads(n = 1) {
  return new TransformStream({ transform: async (chunk, ctrl) => {
    return n-- > 0 ? ctrl.enqueue(chunk) : await never();
  } });
}
function limits(n, { terminate = true } = {}) {
  return new TransformStream({
    transform: async (chunk, ctrl) => {
      ctrl.enqueue(chunk);
      if (--n === 0) {
        if (terminate) ctrl.terminate();
        return never();
      }
    },
    flush: () => {
    }
  }, { highWaterMark: 1 }, { highWaterMark: 0 });
}
function unpromises(promise) {
  const tr = new TransformStream();
  (async () => {
    await (await promise).pipeTo(tr.writable);
  })().catch((error2) => tr.writable.abort(error2).catch(() => {
  }));
  return tr.readable;
}
function bys(arg) {
  if (!arg) return new TransformStream();
  if (typeof arg !== "function") return bys((s) => s.pipeThrough(arg));
  const fn = arg;
  const { writable, readable } = new TransformStream();
  return {
    writable,
    readable: unpromises(fn(readable))
  };
}
function peeks(fn) {
  let i = 0;
  return new TransformStream({ transform: async (chunk, ctrl) => {
    ctrl.enqueue(chunk);
    const ret = fn(chunk, i++);
    if (ret instanceof Promise) await ret;
  } });
}
function logs(mapFn = (s, _i) => s) {
  return bys(peeks(async (e, i) => {
    const ret = mapFn(e, i);
    const val = ret instanceof Promise ? await ret : ret;
    console.log(typeof val === "string" ? val.replace(/\n$/, "") : val);
  }));
}
function mapAddFields(key, fn) {
  let i = 0;
  return new TransformStream({ transform: async (chunk, ctrl) => ctrl.enqueue({
    ...chunk,
    [key]: await fn(chunk, i++)
  }) });
}
function mapMixins(fn) {
  let i = 0;
  return new TransformStream({ transform: async (chunk, ctrl) => ctrl.enqueue({
    ...chunk,
    ...await fn(chunk, i++)
  }) });
}
async function* streamAsyncIterator() {
  const reader = this.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
var mergeStream = (...srcs) => {
  if (!srcs.length) return new ReadableStream({ start: (c) => c.close() });
  if (srcs.length === 1) return toStream(srcs[0]);
  const t = new TransformStream();
  const w = t.writable.getWriter();
  const streams = srcs.map(toStream);
  Promise.all(streams.map(async (s) => {
    for await (const chunk of Object.assign(s, { [Symbol.asyncIterator]: streamAsyncIterator })) await w.write(chunk);
  })).then(async () => w.close()).catch((error2) => {
    streams.forEach((e) => void e.cancel(error2).catch(() => {
    }));
    return w.abort(error2).catch(() => {
    });
  });
  return t.readable;
};
var emptyStream = () => new ReadableStream({ start: (c) => c.close() });
function mergeStreamsBy(transform, sources) {
  if (!sources) return ((srcs) => mergeStreamsBy(transform, srcs));
  if (!sources.length) return emptyStream();
  const streams = sources.map((s) => toStream(s));
  const readers = streams.map((stream) => stream.getReader());
  let slots = streams.map(() => null);
  return new ReadableStream({ pull: async (ctrl) => {
    await Promise.all(readers.map(async (reader, i) => slots[i] ??= await reader.read()));
    slots = await transform([...slots], ctrl);
    if (slots.length !== streams.length) phpdie_default("slot length mismatch");
  } });
}
function mergeStreamsByAscend(ordFn, sources) {
  if (!sources) return ((sources2) => mergeStreamsByAscend(ordFn, sources2));
  let lastEmit = null;
  return mergeStreamsBy(async (slots, ctrl) => {
    const cands = slots.filter((e) => e?.done === false).map((e) => e.value);
    if (!cands.length) {
      ctrl.close();
      return [];
    }
    const peak = minBy(ordFn, cands);
    const index = slots.findIndex((e) => e?.done === false && e?.value === peak);
    if (lastEmit && ordFn(lastEmit.value) > ordFn(peak)) throw new Error("MergeStreamError: one of sources is not ordered by ascending", { cause: {
      prevOrd: ordFn(lastEmit.value),
      currOrd: ordFn(peak),
      prev: lastEmit.value,
      curr: peak
    } });
    lastEmit = { value: peak };
    ctrl.enqueue(peak);
    return [
      ...slots.slice(0, index),
      null,
      ...slots.slice(index + 1)
    ];
  }, sources);
}
function mergeStreamsByDescend(ordFn, sources) {
  if (!sources) return ((srcs) => mergeStreamsByDescend(ordFn, srcs));
  let lastEmit = null;
  return mergeStreamsBy(async (slots, ctrl) => {
    const cands = slots.filter((e) => e?.done === false).map((e) => e.value);
    if (!cands.length) {
      ctrl.close();
      return [];
    }
    const peak = maxBy(ordFn, cands);
    const index = slots.findIndex((e) => e?.done === false && e?.value === peak);
    if (lastEmit && ordFn(lastEmit.value) < ordFn(peak)) phpdie_default(new Error("MergeStreamError: one of sources is not ordered by descending", { cause: {
      prevOrd: ordFn(lastEmit.value),
      currOrd: ordFn(peak),
      prev: lastEmit.value,
      curr: peak
    } }));
    lastEmit = { value: peak };
    ctrl.enqueue(peak);
    return [
      ...slots.slice(0, index),
      null,
      ...slots.slice(index + 1)
    ];
  }, sources);
}
var wseMerges = mergeAll;
var parallels = (...srcs) => wseMerges()(from(srcs));
var merges = (...srcs) => {
  if (!srcs.length) return new TransformStream();
  const upstream = new TransformStream();
  return {
    writable: upstream.writable,
    readable: parallels(upstream.readable, ...srcs.map(toStream))
  };
};
var pMaps = (fn, options = {}) => {
  let i = 0;
  const promises = [];
  return new TransformStream({
    transform: async (chunk, ctrl) => {
      promises.push(fn(chunk, i++));
      if (promises.length >= (options.concurrency ?? 16)) ctrl.enqueue(await promises.shift());
    },
    flush: async (ctrl) => {
      while (promises.length) ctrl.enqueue(await promises.shift());
    }
  });
};
var portals = (arg) => {
  if (!arg) return new TransformStream();
  if (typeof arg !== "function") return throughs((s) => s.pipeThrough(arg));
  const fn = arg;
  const { writable, readable } = new TransformStream();
  return {
    writable,
    readable: fn(readable)
  };
};
var reduceEmits = (fn, _state) => {
  let i = 0;
  return new TransformStream({ transform: async (chunk, ctrl) => {
    const { next, emit } = await fn(_state, chunk, i++);
    _state = next;
    ctrl.enqueue(emit);
  } });
};
var reduces = (fn, state) => {
  let i = 0;
  return new TransformStream({ transform: async (chunk, ctrl) => {
    const ret = fn(state, chunk, i++);
    state = await (ret instanceof Promise ? await ret : ret);
    ctrl.enqueue(state);
  } });
};
function riffles(sep) {
  let last;
  return new TransformStream({
    transform: (chunk, ctrl) => {
      if (last !== void 0) {
        ctrl.enqueue(last);
        ctrl.enqueue(sep);
      }
      last = chunk;
    },
    flush: (ctrl) => ctrl.enqueue(last)
  });
}
function slices(start = 0, end = Infinity) {
  const count = end - start;
  const { readable, writable } = new TransformStream();
  return {
    writable,
    readable: readable.pipeThrough(skips(start)).pipeThrough(limits(count))
  };
}
var matchs = (matcher) => {
  return new TransformStream({ transform: (chunk, ctrl) => ctrl.enqueue(chunk.match(matcher)) });
};
var matchAlls = (matcher) => {
  return new TransformStream({ transform: (chunk, ctrl) => ctrl.enqueue(chunk.matchAll(matcher)) });
};
var replaces = (searchValue, replacement) => {
  return maps((s) => typeof replacement === "string" ? s.replace(searchValue, replacement) : replaceAsync(s, searchValue, replacement));
};
var replaceAlls = (searchValue, replacement) => {
  return maps((s) => typeof replacement === "string" ? s.replaceAll(searchValue, replacement) : replaceAsync(s, searchValue, replacement));
};
function tails(n = 1) {
  const chunks2 = [];
  return new TransformStream({
    transform: (chunk) => {
      chunks2.push(chunk);
      if (chunks2.length > n) chunks2.shift();
    },
    flush: (ctrl) => {
      chunks2.map((e) => ctrl.enqueue(e));
    }
  });
}
function takeWhiles(fn, { terminate = true } = {}) {
  let i = 0;
  let stopped = false;
  return new TransformStream({
    transform: async (chunk, ctrl) => {
      if (stopped) return;
      if (await fn(chunk, i++)) ctrl.enqueue(chunk);
      else {
        stopped = true;
        if (terminate) {
          ctrl.terminate();
          return never();
        }
      }
    },
    flush: () => {
    }
  }, { highWaterMark: 1 }, { highWaterMark: 0 });
}
var tees = (arg) => {
  if (!arg) return new TransformStream();
  if (arg instanceof WritableStream) return tees((s) => s.pipeTo(arg));
  const fn = arg;
  const { writable, readable } = new TransformStream();
  const [a, b] = readable.tee();
  fn(a);
  return {
    writable,
    readable: b
  };
};
function terminates(signal2) {
  return throughs((r) => r.pipeThrough(new TransformStream(), { signal: signal2 }));
}
function throttles(interval, { drop: drop2 = false, keepLast = true } = {}) {
  let timerId = null;
  let cdPromise = Promise.withResolvers();
  let lasts = [];
  return new TransformStream({
    transform: async (chunk, ctrl) => {
      if (timerId) {
        if (keepLast) lasts = [chunk];
        if (drop2) return;
        await cdPromise.promise;
      }
      lasts = [];
      ctrl.enqueue(chunk);
      [cdPromise, timerId] = [Promise.withResolvers(), setTimeout(() => {
        timerId = null;
        cdPromise.resolve();
      }, interval)];
    },
    flush: async (ctrl) => {
      while (timerId) await new Promise((r) => setTimeout(r, interval / 2));
      lasts.map((e) => ctrl.enqueue(e));
    }
  });
}
function toLatests(r) {
  let latest;
  let nextPromise = Promise.withResolvers();
  r.pipeTo(new WritableStream({
    write: (value) => {
      latest = value;
      nextPromise.resolve(value);
      nextPromise = Promise.withResolvers();
    },
    close: () => {
      nextPromise.resolve(void 0);
    }
  }));
  return {
    get latest() {
      if (latest === void 0) return nextPromise.promise;
      return Promise.resolve(latest);
    },
    get next() {
      return nextPromise.promise;
    }
  };
}
var uniqs = () => {
  const set = /* @__PURE__ */ new Set();
  return throughs((s) => s.pipeThrough(filters((x) => {
    if (set.has(x)) return false;
    set.add(x);
    return true;
  })));
};
var uniqBys = (keyFn) => {
  const set = /* @__PURE__ */ new Set();
  return throughs((s) => s.pipeThrough(filters(async (x) => {
    const key = await keyFn(x);
    if (set.has(key)) return false;
    set.add(key);
    return true;
  })));
};
function unwinds(key) {
  return flatMaps((e) => (0, import_unwind_array.unwind)(e, { path: key }));
}
function sflow(...srcs) {
  let r = srcs.length === 1 ? toStream(srcs[0]) : concatStream(srcs);
  return Object.assign(r, {
    _type: null,
    get readable() {
      return r;
    },
    portal: (...args) => sflow(r.pipeThrough(portals(...args))),
    through: (...args) => sflow(r.pipeThrough(_throughs(...args))),
    by: (...args) => sflow(r.pipeThrough(_throughs(...args))),
    byLazy: (t) => _byLazy(r, t),
    cacheSkip: (...args) => sflow(r).byLazy(cacheSkips(...args)),
    cacheList: (...args) => sflow(r).byLazy(cacheLists(...args)),
    cacheTail: (...args) => sflow(r).byLazy(cacheTails(...args)),
    chunkBy: (...args) => sflow(r.pipeThrough(chunkBys(...args))),
    chunkIf: (...args) => sflow(r.pipeThrough(chunkIfs(...args))),
    buffer: (...args) => sflow(r.pipeThrough(chunks(...args))),
    chunk: (...args) => sflow(r.pipeThrough(chunks(...args))),
    convolve: (...args) => sflow(r.pipeThrough(convolves(...args))),
    abort: (...args) => sflow(r.pipeThrough(terminates(...args))),
    chunkInterval: (...args) => sflow(r.pipeThrough(chunkIntervals(...args))),
    interval: (...args) => sflow(r.pipeThrough(chunkIntervals(...args))),
    debounce: (...args) => sflow(r.pipeThrough(debounces(...args))),
    filter: (...args) => sflow(r.pipeThrough(filters(...args))),
    find: (...args) => sflow(r.pipeThrough(finds(...args))),
    flatMap: (...args) => sflow(r.pipeThrough(flatMaps(...args))),
    flat: (...args) => sflow(r).by(flats(...args)),
    join: (...args) => sflow(r.pipeThrough(riffles(...args))),
    match: (...args) => sflow(r.pipeThrough(matchs(...args))),
    matchAll: (...args) => sflow(r.pipeThrough(matchAlls(...args))),
    replace: (...args) => sflow(r.pipeThrough(replaces(...args))),
    replaceAll: (...args) => sflow(r.pipeThrough(replaceAlls(...args))),
    merge: (...args) => sflow(r.pipeThrough(merges(...args))),
    concat: (srcs2) => sflow(r.pipeThrough(concats(srcs2))),
    confluence: (...args) => sflow(r.pipeThrough(confluences(...args))),
    confluenceByZip: () => sflow(r).by(confluences()),
    confluenceByConcat: () => sflow(r).by((srcs2) => concatStream(srcs2)),
    confluenceByParallel: () => sflow(r).by((srcs2) => sflow(srcs2).toArray().then((srcs3) => mergeStream(...srcs3))).confluence(),
    confluenceByAscend: (ordFn) => sflow(r).chunk().map((srcs2) => mergeStreamsByAscend(ordFn, srcs2)).confluence(),
    confluenceByDescend: (ordFn) => sflow(r).chunk().map((srcs2) => mergeStreamsByDescend(ordFn, srcs2)).confluence(),
    limit: (...args) => sflow(r).byLazy(limits(...args)),
    head: (...args) => sflow(r.pipeThrough(heads(...args))),
    map: (...args) => sflow(r.pipeThrough(maps(...args))),
    mapAddField: (...args) => sflow(r.pipeThrough(mapAddFields(...args))),
    mapMixin: (...args) => sflow(r.pipeThrough(mapMixins(...args))),
    log: (...args) => sflow(r.pipeThrough(logs(...args))),
    uniq: (...args) => sflow(r.pipeThrough(uniqs(...args))),
    unique: (...args) => sflow(r.pipeThrough(uniqs(...args))),
    uniqBy: (...args) => sflow(r.pipeThrough(uniqBys(...args))),
    unwind: (...args) => sflow(r.pipeThrough(unwinds(...args))),
    asyncMap: (...args) => sflow(r.pipeThrough(asyncMaps(...args))),
    pMap: (...args) => sflow(r.pipeThrough(pMaps(...args))),
    peek: (...args) => sflow(r.pipeThrough(peeks(...args))),
    riffle: (...args) => sflow(r.pipeThrough(riffles(...args))),
    forEach: (...args) => sflow(r.pipeThrough(forEachs(...args))),
    reduce: (...args) => sflow(r.pipeThrough(reduces(...args))),
    reduceEmit: (...args) => sflow(r.pipeThrough(reduceEmits(...args))),
    skip: (...args) => sflow(r.pipeThrough(skips(...args))),
    slice: (...args) => sflow(r.pipeThrough(slices(...args))),
    tail: (...args) => sflow(r.pipeThrough(tails(...args))),
    takeWhile: (...args) => sflow(r.pipeThrough(takeWhiles(...args))),
    tees: (...args) => sflow(r.pipeThrough(_tees(...args))),
    forkTo: (...args) => sflow(r.pipeThrough(_tees(...args))),
    fork: () => {
      let b;
      [r, b] = r.tee();
      return sflow(b);
    },
    throttle: (...args) => sflow(r.pipeThrough(throttles(...args))),
    preventAbort: () => sflow(r.pipeThrough(throughs(), { preventAbort: true })),
    preventClose: () => sflow(r.pipeThrough(throughs(), { preventClose: true })),
    preventCancel: () => sflow(r.pipeThrough(throughs(), { preventCancel: true })),
    onStart: (start) => sflow(r).by(new TransformStream({ start })),
    onTransform: (transform) => sflow(r).by(new TransformStream({ transform })),
    onFlush: (flush) => sflow(r).by(new TransformStream({ flush })),
    done: () => r.pipeTo(nils()),
    end: (dst = nils()) => r.pipeTo(dst),
    to: (dst = nils()) => r.pipeTo(dst),
    run: () => r.pipeTo(nils()),
    toEnd: () => r.pipeTo(nils()),
    toNil: () => r.pipeTo(nils()),
    toArray: () => toArray(r),
    toCount: async () => {
      let i = 0;
      const d = r.getReader();
      while (!(await d.read()).done) i++;
      return i;
    },
    toFirst: () => toPromise(sflow(r).limit(1, { terminate: true })),
    toFirstMatch: (predicate) => toPromise(sflow(r).find(predicate)),
    toLast: () => toPromise(sflow(r).tail(1)),
    toExactlyOne: async () => {
      const a = await toArray(r);
      if (a.length !== 1) phpdie_default(`Expect exactly 1 Item, but got ${a.length}`);
      return a[0];
    },
    toOne: async () => {
      const a = await toArray(r);
      if (a.length > 1) phpdie_default(`Expect only 1 Item, but got ${a.length}`);
      return a[0];
    },
    toAtLeastOne: async () => {
      const a = await toArray(r);
      if (a.length > 1) phpdie_default(`Expect only 1 Item, but got ${a.length}`);
      if (a.length < 1) phpdie_default(`Expect at least 1 Item, but got ${a.length}`);
      return a[0];
    },
    toLatest: () => toLatests(sflow(r)),
    toLog: (...args) => sflow(r.pipeThrough(logs(...args))).done(),
    lines: (...args) => sflow(r.pipeThrough(lines(...args))),
    toResponse: (init) => new Response(r, init),
    text: (init) => new Response(r.pipeThrough(new TextEncoderStream()), init).text(),
    json: (init) => new Response(r.pipeThrough(new TextEncoderStream()), init).json(),
    blob: (init) => new Response(sflow(r), init).blob(),
    arrayBuffer: (init) => new Response(r, init).arrayBuffer(),
    [Symbol.asyncIterator]: streamAsyncIterator
  });
}
var _tees = (arg) => {
  if (!arg) return new TransformStream();
  if (arg instanceof WritableStream) return tees((s) => s.pipeTo(arg));
  const fn = arg;
  const { writable, readable } = new TransformStream();
  const [a, b] = readable.tee();
  fn(sflow(a));
  return {
    writable,
    readable: b
  };
};
var _throughs = (arg) => {
  if (!arg) return new TransformStream();
  if (typeof arg !== "function") return throughs((s) => s.pipeThrough(arg));
  const fn = arg;
  const { writable, readable } = new TransformStream();
  return {
    writable,
    readable: sflow(fn(sflow(readable)))
  };
};
function _byLazy(r, t) {
  const reader = r.getReader();
  const tw = t.writable.getWriter();
  const tr = t.readable.getReader();
  return sflow(new ReadableStream({
    start: async (ctrl) => {
      (async () => {
        while (true) {
          const { done, value } = await tr.read();
          if (done) return ctrl.close();
          ctrl.enqueue(value);
        }
      })();
    },
    pull: async (_ctrl) => {
      const { done, value } = await reader.read();
      if (done) return tw.close();
      await tw.write(value);
    },
    cancel: async (r2) => {
      reader.cancel(r2);
      tr.cancel(r2);
    }
  }, { highWaterMark: 0 }));
}
function composers(stream) {
  return Object.assign(stream, { by: (appendStream) => composers({
    writable: stream.writable,
    readable: stream.readable.pipeThrough(appendStream)
  }) });
}

// src/node.ts
function makeNode(name, transform) {
  const node = {
    name,
    transform,
    pipe(next) {
      return makeNode(
        `${name}\u2192${next.name}`,
        (flow) => next.transform(transform(flow))
      );
    },
    run(source2) {
      return transform(sflow(source2));
    }
  };
  return node;
}
function createNode(name, transform) {
  return makeNode(name, transform);
}
function identityNode(name) {
  return makeNode(name, (flow) => flow);
}

// src/machine.ts
var TRANSITIONS = {
  idle: { START: "running" },
  running: { STOP: "stopped", ERROR: "error", COMPLETE: "idle" },
  error: { RESET: "idle", STOP: "stopped" },
  stopped: {}
};
function createProcessorActor(name) {
  const actor = {
    status: "idle",
    context: { name, errors: [], startedAt: null },
    send(event2) {
      if (event2.type === "START_AT") {
        actor.context.startedAt = event2.ts;
        return;
      }
      const next = TRANSITIONS[actor.status][event2.type];
      if (!next) return;
      if (event2.type === "ERROR") actor.context.errors.push(event2.message);
      if (event2.type === "COMPLETE") actor.context.startedAt = null;
      actor.status = next;
    },
    stop() {
      actor.status = "stopped";
    }
  };
  return actor;
}

// src/debug.ts
var RING_SIZE = 200;
var ring = [];
var head = 0;
var logSink = null;
function setLogSink(fn) {
  logSink = fn;
}
function log2(subsystem, severity, message, data) {
  const entry = data !== void 0 ? { ts: Date.now(), subsystem, severity, message, data } : { ts: Date.now(), subsystem, severity, message };
  ring[head % RING_SIZE] = entry;
  head++;
  logSink?.(entry);
}
function logs2() {
  if (head <= RING_SIZE) return ring.slice(0, head);
  const start = head % RING_SIZE;
  return ring.slice(start).concat(ring.slice(0, start));
}
function clearLogs() {
  ring.length = 0;
  head = 0;
}
function snapshot() {
  const processors = registry.snapshot();
  const recent = logs2().slice(-20);
  return {
    ts: Date.now(),
    processors,
    recentLogs: recent,
    totals: { processors: processors.length, logs: head }
  };
}
function inspect(name) {
  const all = registry.inspect();
  if (name === void 0) return all;
  const found = all.find((p) => p.name === name);
  if (!found) return null;
  return {
    name: found.name,
    status: found.status,
    chunksIn: found.chunksIn,
    chunksOut: found.chunksOut,
    errors: found.errors.slice(-10),
    uptimeMs: found.uptimeMs()
  };
}

// src/registry.ts
var entries = /* @__PURE__ */ new Map();
var nameCounter = 0;
function uniqueName(base) {
  return entries.has(base) ? `${base}-${++nameCounter}` : base;
}
function stateView(actor, counters) {
  return {
    get name() {
      return actor.context.name;
    },
    get status() {
      return actor.status;
    },
    get chunksIn() {
      return counters.in;
    },
    get chunksOut() {
      return counters.out;
    },
    get errors() {
      return actor.context.errors;
    },
    get startedAt() {
      return actor.context.startedAt;
    },
    uptimeMs() {
      const s = actor.context.startedAt;
      return s == null ? 0 : Date.now() - s;
    },
    send(event2) {
      const before = actor.status;
      actor.send(event2);
      if (actor.status !== before) log2("registry", event2.type === "ERROR" ? "error" : "info", `${actor.context.name}: ${before} -> ${actor.status}`);
    },
    incIn() {
      counters.in++;
    },
    incOut() {
      counters.out++;
    }
  };
}
var registry = {
  register(name) {
    const key = uniqueName(name);
    const actor = createProcessorActor(key);
    const counters = { in: 0, out: 0 };
    entries.set(key, { actor, counters });
    return stateView(actor, counters);
  },
  deregister(name) {
    entries.get(name)?.actor.stop();
    entries.delete(name);
  },
  inspect() {
    return [...entries.values()].map((e) => stateView(e.actor, e.counters));
  },
  snapshot() {
    return [...entries.values()].map((e) => ({
      name: e.actor.context.name,
      status: e.actor.status,
      chunksIn: e.counters.in,
      chunksOut: e.counters.out,
      errors: e.actor.context.errors.slice(-10),
      uptimeMs: e.actor.context.startedAt == null ? 0 : Date.now() - e.actor.context.startedAt
    }));
  }
};

// src/streams.ts
function notify(ref) {
  const fn = ref.v;
  ref.v = null;
  if (fn) fn();
}
function splitStream(iter, onOut) {
  const stdoutQueue = [];
  const stderrQueue = [];
  const stdoutWake = { v: null };
  const stderrWake = { v: null };
  let done = false;
  (async () => {
    for await (const chunk of iter) {
      if (onOut) onOut();
      if (chunk.type === "error" || chunk.type === "signal") {
        stderrQueue.push(chunk);
        notify(stderrWake);
      } else {
        stdoutQueue.push(chunk);
        notify(stdoutWake);
      }
    }
    done = true;
    notify(stdoutWake);
    notify(stderrWake);
  })();
  async function* drain(queue, wake) {
    let idx = 0;
    while (true) {
      if (idx < queue.length) {
        yield queue[idx++];
      } else if (done) {
        return;
      } else {
        if (idx > 0) {
          queue.splice(0, idx);
          idx = 0;
        }
        await new Promise((r) => {
          wake.v = r;
        });
      }
    }
  }
  return {
    stdout: drain(stdoutQueue, stdoutWake),
    stderr: drain(stderrQueue, stderrWake)
  };
}
function createAsyncQueue() {
  const queue = [];
  const waiters = [];
  let closed = false;
  let error2 = null;
  return {
    push(v) {
      const w = waiters.shift();
      if (w) w({ value: v, done: false });
      else queue.push(v);
    },
    finish(err) {
      if (err !== void 0) error2 = err;
      closed = true;
      for (const w of waiters.splice(0)) w({ value: void 0, done: true });
    },
    async *iter() {
      while (!closed || queue.length) {
        if (queue.length) {
          yield queue.shift();
          continue;
        }
        const next = await new Promise((r) => waiters.push(r));
        if (next.done) break;
        yield next.value;
      }
      if (error2) throw error2;
    }
  };
}

// src/processor.ts
function toAsyncIterable(source2) {
  if (source2 == null) return stdinIter();
  if (Symbol.asyncIterator in source2) return source2;
  return webReadable(source2);
}
async function* stdinIter() {
  for await (const chunk of process.stdin) yield chunk;
}
async function* webReadable(readable) {
  const reader = readable.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
async function drainToWritable(iter, dest) {
  if (dest == null) {
    const enc5 = new TextEncoder();
    for await (const chunk of iter) process.stdout.write(enc5.encode(JSON.stringify(chunk) + "\n"));
    return;
  }
  if (dest instanceof WritableStream) {
    const writer = dest.getWriter();
    try {
      for await (const chunk of iter) await writer.write(chunk);
      await writer.close();
    } finally {
      writer.releaseLock();
    }
    return;
  }
  const w = dest;
  for await (const chunk of iter) await new Promise((res, rej) => w.write(chunk, (e) => e ? rej(e) : res()));
  await new Promise((res) => w.end(res));
}
function createProcessor(config) {
  const state = registry.register(config.name);
  let split2 = null;
  function buildSplit() {
    const sourceRaw = toAsyncIterable(config.input ?? null);
    const source2 = trackInput(sourceRaw, state);
    const flow = sflow(source2);
    const transformed = config.transform(flow);
    return splitStream(transformed, () => state.incOut());
  }
  const handle = {
    name: state.name,
    state,
    _transform: config.transform,
    get output() {
      if (!split2) split2 = buildSplit();
      return split2.stdout;
    },
    get stdout() {
      if (!split2) split2 = buildSplit();
      return split2.stdout;
    },
    get stderr() {
      if (!split2) split2 = buildSplit();
      return split2.stderr;
    },
    async start() {
      if (state.status === "running") return;
      state.send({ type: "START" });
      state.send({ type: "START_AT", ts: Date.now() });
      split2 = buildSplit();
      try {
        await drainToWritable(split2.stdout, config.output);
        state.send({ type: "COMPLETE" });
      } catch (e) {
        state.send({ type: "ERROR", message: String(e) });
        throw e;
      }
    },
    stop() {
      state.send({ type: "STOP" });
      split2 = null;
    },
    pipe(next) {
      const composedTransform = (flow) => next._transform(handle._transform(flow));
      const pipedConfig = {
        name: `${state.name}\u2192${next.name}`,
        transform: composedTransform
      };
      if (config.input !== void 0) pipedConfig.input = config.input;
      if (config.output !== void 0) pipedConfig.output = config.output;
      return createProcessor(pipedConfig);
    }
  };
  return handle;
}
async function* trackInput(source2, state) {
  for await (const chunk of source2) {
    state.incIn();
    yield chunk;
  }
}

// src/pipeline.ts
function pipe2(...nodes) {
  if (nodes.length === 0) throw new Error("pipe() requires at least one node");
  return nodes.reduce((acc, next) => acc.pipe(next));
}
function connect(from2, to) {
  return {
    [Symbol.asyncIterator]() {
      const source2 = from2.run(emptySource());
      return to.run(source2)[Symbol.asyncIterator]();
    }
  };
}
async function* emptySource() {
}
function source(items) {
  return createNode("source", (_flow) => sflow(items));
}
function sink(name) {
  return createNode(name, (flow) => flow);
}

// src/operators.ts
function mux(...sources) {
  return createNode(
    "mux",
    (_flow) => sources.slice(1).reduce(
      (acc, s) => acc.merge(sflow(s)),
      sflow(sources[0])
    )
  );
}
function split(flow, n) {
  const branches = [];
  let s = flow;
  for (let i = 0; i < n - 1; i++) {
    const [a, b] = s.tee();
    branches.push(sflow(a));
    s = sflow(b);
  }
  branches.push(s);
  return branches;
}
function gate(pred) {
  return createNode(
    "gate",
    (flow) => flow.through(async function* (src) {
      for await (const v of src) if (await pred(v)) yield v;
    })
  );
}
function scan(fn, seed) {
  return createNode(
    "scan",
    (flow) => flow.through(async function* (src) {
      let acc = seed;
      for await (const v of src) {
        acc = fn(acc, v);
        yield acc;
      }
    })
  );
}
function zip(...sources) {
  return createNode(
    "zip",
    (_flow) => sflow((async function* () {
      const iters = sources.map((s) => s[Symbol.asyncIterator]());
      while (true) {
        const nexts = await Promise.all(iters.map((it) => it.next()));
        if (nexts.some((n) => n.done)) break;
        yield nexts.map((n) => n.value);
      }
    })())
  );
}
function withBackpressure(hwm) {
  return createNode(
    "backpressure",
    (flow) => flow.through(async function* (src) {
      let count = 0;
      for await (const v of src) {
        count++;
        if (count > hwm) await new Promise((r) => setImmediate(r));
        yield v;
      }
    })
  );
}
function batch(n) {
  return createNode(
    "batch",
    (flow) => flow.chunk(n)
  );
}
function window(ms) {
  return createNode(
    "window",
    (flow) => flow.chunkInterval(ms)
  );
}
function throttle(ms) {
  return createNode("throttle", (flow) => flow.throttle(ms));
}
function debounce(ms) {
  return createNode("debounce", (flow) => flow.debounce(ms));
}
function take(n) {
  return createNode("take", (flow) => flow.limit(n));
}
function drop(n) {
  return createNode("drop", (flow) => flow.skip(n));
}
function distinct(keyFn) {
  return createNode("distinct", (flow) => keyFn ? flow.uniqBy(keyFn) : flow.uniq());
}
function parallel(fn, concurrency) {
  return createNode(
    "parallel",
    (flow) => flow.pMap(fn, { concurrency })
  );
}

// src/ws-frame.ts
function encodeFrame(chunk) {
  const typeBytes = new TextEncoder().encode(chunk.type);
  const payload = encodeChunk(chunk);
  const meta = chunk.meta ? new TextEncoder().encode(JSON.stringify(chunk.meta)) : new Uint8Array(0);
  const out = new Uint8Array(1 + typeBytes.length + 4 + meta.length + payload.length);
  let o = 0;
  out[o++] = typeBytes.length;
  out.set(typeBytes, o);
  o += typeBytes.length;
  const dv = new DataView(out.buffer, out.byteOffset);
  dv.setUint32(o, meta.length);
  o += 4;
  out.set(meta, o);
  o += meta.length;
  out.set(payload, o);
  return out;
}
function decodeFrame(buf) {
  const tlen = buf[0] ?? 0;
  const type = new TextDecoder().decode(buf.subarray(1, 1 + tlen));
  const dv = new DataView(buf.buffer, buf.byteOffset + 1 + tlen, 4);
  const mlen = dv.getUint32(0);
  const metaStart = 1 + tlen + 4;
  const meta = mlen > 0 ? JSON.parse(new TextDecoder().decode(buf.subarray(metaStart, metaStart + mlen))) : void 0;
  const payload = buf.subarray(metaStart + mlen);
  return decodeChunk(type, payload, meta);
}

// src/browser-stdio.ts
var enc4 = new TextEncoder();
var dec4 = new TextDecoder();
function createBrowserStdio(config = { name: "browser-stdio" }) {
  const inputType = config.inputType ?? "rpc";
  const endpoints = /* @__PURE__ */ new Map();
  let closing = false;
  let wake = null;
  const pending = [];
  let output;
  if (config.stream) {
    async function* incoming() {
      while (!closing) {
        const next = pending.shift();
        if (next) {
          yield next;
          continue;
        }
        await new Promise((done) => {
          wake = done;
        });
        wake = null;
      }
    }
    output = createProcessor({
      name: config.name,
      input: incoming(),
      transform: (flow) => flow
    });
    (async () => {
      for await (const chunk of output.output) void chunk;
    })().catch(() => {
    });
  }
  async function deliver(chunk) {
    const raw2 = chunk.data;
    const items = Array.isArray(raw2) ? raw2 : [raw2];
    const answers = [];
    for (const item of items) {
      const record = item ?? {};
      const meta = record.meta ?? {};
      const params = record.params ?? {};
      const target = meta.target ?? params.name;
      const parts = typeof target === "string" ? target.split("_") : [];
      const handler = (typeof target === "string" ? endpoints.get(target) : void 0) ?? (parts.length ? endpoints.get(parts[0]) : void 0) ?? endpoints.get("*");
      if (!handler) {
        answers.push(JSON.stringify({ jsonrpc: "2.0", id: record.id ?? null, error: { code: -32601, message: `no endpoint for ${String(target ?? "request")}` } }));
        continue;
      }
      const answer = await handler(record);
      if (answer === void 0) continue;
      answers.push(dec4.decode(encodeChunk({ type: "rpc", data: answer })).trim());
    }
    return answers.join("\n");
  }
  return {
    async input(line) {
      const chunk = decodeChunk(inputType, enc4.encode(line));
      if (config.stream) {
        pending.push(chunk);
        wake?.();
      }
      return deliver(chunk);
    },
    endpoints,
    attach(name, handler) {
      endpoints.set(name, handler);
      return () => endpoints.delete(name);
    },
    close() {
      closing = true;
      wake?.();
    },
    ...output ? { output } : {}
  };
}
export {
  CODECS,
  ack,
  adjacency,
  archive,
  arrow,
  ast,
  audio,
  avroschema,
  batch,
  binary,
  bool,
  cbor,
  certificate,
  ciphertext,
  clearLogs,
  command,
  complex128,
  complex64,
  connect,
  createAsyncQueue,
  createBrowserStdio,
  createNode,
  createProcessor,
  createProcessorActor,
  csv,
  debounce,
  inspect as debugInspect,
  log2 as debugLog,
  logs2 as debugLogs,
  snapshot as debugSnapshot,
  decodeChunk,
  decodeFrame as decodeWsFrame,
  delta,
  detectFile,
  detectMime,
  dhcp,
  distinct,
  dns,
  docx,
  drop,
  embedding,
  encodeChunk,
  encodeFrame as encodeWsFrame,
  envelope,
  epub,
  error,
  event,
  float32,
  float64,
  font,
  frame,
  gate,
  geojson,
  gltf,
  graphml,
  graphql,
  hash,
  hmac,
  html,
  httpRequest,
  httpResponse,
  icmp,
  identityNode,
  image,
  ini,
  int16,
  int32,
  int64,
  int8,
  json,
  jsonschema,
  jwt,
  keypair,
  log,
  markdown,
  metric,
  mimeToChunkType,
  msgpack,
  multipart,
  mux,
  nack,
  ndjson,
  nil,
  obj,
  ohlcv,
  onnx,
  parallel,
  parquet,
  patch,
  pdf,
  pipe2 as pipe,
  playlist,
  pointcloud,
  pptx,
  protobuf,
  qrcode,
  raw,
  registry,
  rpc,
  safetensors,
  scan,
  setLogSink,
  shader,
  signal,
  signature,
  sink,
  socketio,
  source,
  sourcemap,
  span,
  split,
  splitStream,
  sql,
  sse,
  subtitle,
  take,
  tensor,
  text,
  throttle,
  timeseries,
  timestamp,
  token,
  toml,
  uint16,
  uint32,
  uint64,
  uint8,
  uuid,
  video,
  wasm,
  websocket,
  webtransport,
  window,
  withBackpressure,
  xlsx,
  xml,
  yaml,
  zip
};
