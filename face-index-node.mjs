// ============================================================
// Índice facial no próprio uploader (Node) — "Rota 3".
// Gera os MESMOS vetores que o painel gera no navegador
// (@vladmandic/face-api, tinyFaceDetector + landmark68 + recognition,
// descritor de 128 números quantizado em int8), então o que já existe
// continua compatível e a busca por rosto no cliente não muda em nada.
//
// Se as dependências pesadas (@tensorflow/tfjs-node) não estiverem
// instaladas, initFaceApi devolve {ok:false} e o upload segue normal,
// só sem índice — nunca derruba o envio das fotos.
// ============================================================
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';

const require = createRequire(import.meta.url);
let _api = null;

// O @tensorflow/tfjs-node ainda chama util.isNullOrUndefined & cia., que o Node
// removeu na v23. Sem este remendo ele estoura logo no primeiro decodeImage.
function _patchLegacyUtil() {
  const util = require('node:util');
  const shims = {
    isNullOrUndefined: v => v === null || v === undefined,
    isNull: v => v === null,
    isUndefined: v => v === undefined,
    isString: v => typeof v === 'string',
    isNumber: v => typeof v === 'number',
    isBoolean: v => typeof v === 'boolean',
    isFunction: v => typeof v === 'function',
    isObject: v => v !== null && typeof v === 'object',
    isArray: Array.isArray,
    isPrimitive: v => v === null || (typeof v !== 'object' && typeof v !== 'function'),
    isBuffer: v => Buffer.isBuffer(v),
  };
  for (const [k, fn] of Object.entries(shims)) if (typeof util[k] !== 'function') util[k] = fn;
}

export async function initFaceApi() {
  if (_api) return _api;
  try {
    _patchLegacyUtil();
    const tf = require('@tensorflow/tfjs-node');
    const faceapi = require('@vladmandic/face-api');
    const modelPath = join(dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
    await faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);
    _api = { ok: true, tf, faceapi, opts: new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.6 }) };
  } catch (e) {
    _api = { ok: false, reason: e.message };
  }
  return _api;
}

// Recebe um JPEG (tfjs-node não decodifica webp) e devolve os rostos no
// mesmo formato do índice do painel: { d: int8[128], b: [x,y,w,h] 0..1 }.
export async function detectFacesInJpeg(api, jpegBuffer) {
  const t = api.tf.node.decodeImage(jpegBuffer, 3);
  try {
    const dets = await api.faceapi.detectAllFaces(t, api.opts).withFaceLandmarks().withFaceDescriptors();
    const H = t.shape[0], W = t.shape[1];
    const r3 = x => Math.round(x * 1000) / 1000;
    const q1 = x => Math.max(-127, Math.min(127, Math.round(x * 127)));
    return dets
      .filter(d => d.detection.box.width / W >= 0.045)   // rosto miúdo = vetor impreciso
      .map(d => {
        const b = d.detection.box;
        return {
          d: Array.from(d.descriptor).map(q1),
          b: [r3(b.x / W), r3(b.y / H), r3(b.width / W), r3(b.height / H)],
          s: r3(d.detection.score),
        };
      });
  } finally {
    t.dispose();   // sem isso a memória do tensorflow cresce sem parar no lote
  }
}

// Versão de detecção: 800px no maior lado, JPEG (mesma escala que o painel usa).
export async function toDetectionJpeg(sharp, bytes) {
  return sharp(bytes).rotate().resize(800, 800, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
}

export function buildIndexPayload(faces, photoIds) {
  return {
    data: { faces, photos: photoIds, qv: 1, built_at: new Date().toISOString() },
    face_count: faces.length,
    photo_count: photoIds.length,
    updated_at: new Date().toISOString(),
  };
}
