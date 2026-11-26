// عارض الصورة الحية بـ WebGL: يحرك المناطق حسب حقل السرعة في حلقة سلسة بلا قفزة
const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = vec2(p.x*0.5+0.5, 0.5-p.y*0.5); gl_Position = vec4(p,0.,1.); }`;
const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D img; uniform sampler2D flow;
uniform float phase; uniform vec2 vscale;
void main(){
  vec2 v = (texture(flow, uv).rg * 2.0 - 1.0) * vscale; // إزاحة الدورة كاملة بوحدات uv
  vec4 a = texture(img, uv - v * phase);
  vec4 b = texture(img, uv - v * (phase - 1.0));
  o = mix(a, b, phase);
}`;

let G = null;
function init() {
  if (G) return G;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
  if (!gl) { G = { ok: false }; return G; }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
  G = { ok: true, canvas, gl, prog, imgTex: mk(), flowTex: mk(), imgKey: null, flowKey: null,
    u: { img: gl.getUniformLocation(prog, 'img'), flow: gl.getUniformLocation(prog, 'flow'), phase: gl.getUniformLocation(prog, 'phase'), vscale: gl.getUniformLocation(prog, 'vscale') } };
  return G;
}

export const cineSupported = () => init().ok;

/**
 * يرسم الإطار ويعيد اللوح (canvas) أو null
 * field: {data: Float32Array, gw, gh, key}, img: مصدر الصورة، phase: 0..1
 */
export function renderCine(img, imgKey, w, h, field, phase) {
  const g = init();
  if (!g.ok) return null;
  const { gl } = g;
  const maxSide = 1600;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
  if (g.canvas.width !== cw || g.canvas.height !== ch) { g.canvas.width = cw; g.canvas.height = ch; }
  gl.viewport(0, 0, cw, ch);
  gl.useProgram(g.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, g.imgTex);
  if (g.imgKey !== imgKey) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    g.imgKey = imgKey;
  }
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, g.flowTex);
  let vmax = 1e-6;
  for (let i = 0; i < field.data.length; i++) vmax = Math.max(vmax, Math.abs(field.data[i]));
  if (g.flowKey !== field.key) {
    const bytes = new Uint8Array(field.gw * field.gh * 4);
    for (let i = 0; i < field.gw * field.gh; i++) {
      bytes[i * 4] = Math.round((field.data[i * 2] / vmax * 0.5 + 0.5) * 255);
      bytes[i * 4 + 1] = Math.round((field.data[i * 2 + 1] / vmax * 0.5 + 0.5) * 255);
      bytes[i * 4 + 3] = 255;
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, field.gw, field.gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    g.flowKey = field.key;
  }
  gl.uniform1i(g.u.img, 0);
  gl.uniform1i(g.u.flow, 1);
  gl.uniform1f(g.u.phase, phase);
  // تحويل الإزاحة من بكسلات الصورة إلى وحدات uv لكل محور
  gl.uniform2f(g.u.vscale, vmax / w, vmax / h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return g.canvas;
}
