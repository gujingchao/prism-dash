import * as C from '../../config';
import { buildCube, buildGroundGrid } from '../mesh';
import { PACKED_FLOATS } from '../particles';
import { collectBoxes, sunRadius, type BoxInstance, type FrameData, type Renderer } from '../scene';
import { ShaderProgram, createRenderTarget, deleteRenderTarget, type RenderTarget } from './glutil';
import * as S from './shaders';

const INSTANCE_FLOATS = 13; // pos3 rot3 scale3 color4
const MAX_INSTANCES = 1024;
const MAX_PARTICLES = 4096;

/**
 * Hand-written WebGL2 pipeline:
 *   scene FBO (HDR when EXT_color_buffer_float is available)
 *     sky (fullscreen) → ground (procedural grid) → boxes (1 instanced draw) → particles (additive points)
 *   bloom: bright-pass/downsample → separable Gaussian ping-pong ×2
 *   composite: chromatic aberration + bloom + ACES tonemap + vignette → default framebuffer
 */
export class WebGLRenderer implements Renderer {
  readonly name = 'WebGL2';
  hdr = false;

  private readonly gl: WebGL2RenderingContext;
  private width = 1;
  private height = 1;

  private sky!: ShaderProgram;
  private ground!: ShaderProgram;
  private box!: ShaderProgram;
  private particle!: ShaderProgram;
  private bright!: ShaderProgram;
  private blur!: ShaderProgram;
  private composite!: ShaderProgram;

  private emptyVao!: WebGLVertexArrayObject;
  private groundVao!: WebGLVertexArrayObject;
  private groundCount = 0;
  private boxVao!: WebGLVertexArrayObject;
  private boxIndexCount = 0;
  private instanceBuffer!: WebGLBuffer;
  private particleVao!: WebGLVertexArrayObject;
  private particleBuffer!: WebGLBuffer;

  private readonly instanceData = new Float32Array(MAX_INSTANCES * INSTANCE_FLOATS);
  private readonly particleData = new Float32Array(MAX_PARTICLES * PACKED_FLOATS);
  private readonly boxes: BoxInstance[] = [];

  private scene?: RenderTarget;
  private bloomA?: RenderTarget;
  private bloomB?: RenderTarget;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false, // we render into an offscreen FBO anyway
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.init();
  }

  get contextLost(): boolean {
    return this.gl.isContextLost();
  }

  /** (Re)creates every GPU resource. Called on construction and after webglcontextrestored. */
  init(): void {
    const gl = this.gl;
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');

    this.sky = new ShaderProgram(gl, S.FULLSCREEN_VS, S.SKY_FS, 'sky');
    this.ground = new ShaderProgram(gl, S.GROUND_VS, S.GROUND_FS, 'ground');
    this.box = new ShaderProgram(gl, S.BOX_VS, S.BOX_FS, 'box');
    this.particle = new ShaderProgram(gl, S.PARTICLE_VS, S.PARTICLE_FS, 'particle');
    this.bright = new ShaderProgram(gl, S.FULLSCREEN_VS, S.BRIGHT_FS, 'bright');
    this.blur = new ShaderProgram(gl, S.FULLSCREEN_VS, S.BLUR_FS, 'blur');
    this.composite = new ShaderProgram(gl, S.FULLSCREEN_VS, S.COMPOSITE_FS, 'composite');

    this.emptyVao = gl.createVertexArray()!;

    // Ground plane
    const grid = buildGroundGrid(-70, 70, C.SPAWN_Z - 30, 20, 28, 100);
    this.groundVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.groundVao);
    this.staticBuffer(gl.ARRAY_BUFFER, grid.positions);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.staticBuffer(gl.ELEMENT_ARRAY_BUFFER, grid.indices);
    this.groundCount = grid.indices.length;

    // Instanced cube
    const cube = buildCube();
    this.boxVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.boxVao);
    this.staticBuffer(gl.ARRAY_BUFFER, cube.positions);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.staticBuffer(gl.ARRAY_BUFFER, cube.normals);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    this.staticBuffer(gl.ELEMENT_ARRAY_BUFFER, cube.indices);
    this.boxIndexCount = cube.indices.length;

    this.instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    const stride = INSTANCE_FLOATS * 4;
    const attribs: [loc: number, size: number, offset: number][] = [[2, 3, 0], [3, 3, 12], [4, 3, 24], [5, 4, 36]];
    for (const [loc, size, offset] of attribs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(loc, 1);
    }

    // Particles
    this.particleVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.particleVao);
    this.particleBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.particleData.byteLength, gl.DYNAMIC_DRAW);
    const pStride = PACKED_FLOATS * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, pStride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, pStride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, pStride, 28);

    gl.bindVertexArray(null);
    this.scene = this.bloomA = this.bloomB = undefined;
    this.allocateTargets();
  }

  private staticBuffer(target: number, data: ArrayBufferView): void {
    const gl = this.gl;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(target, buf);
    gl.bufferData(target, data, gl.STATIC_DRAW);
  }

  resize(w: number, h: number): void {
    if (w === this.width && h === this.height && this.scene) return;
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.allocateTargets();
  }

  private allocateTargets(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    deleteRenderTarget(gl, this.scene);
    deleteRenderTarget(gl, this.bloomA);
    deleteRenderTarget(gl, this.bloomB);
    const bw = Math.max(1, this.width >> 1);
    const bh = Math.max(1, this.height >> 1);
    try {
      this.scene = createRenderTarget(gl, this.width, this.height, this.hdr, true);
      this.bloomA = createRenderTarget(gl, bw, bh, this.hdr, false);
      this.bloomB = createRenderTarget(gl, bw, bh, this.hdr, false);
    } catch (err) {
      if (!this.hdr) throw err;
      // Some drivers expose the extension but refuse RGBA16F attachments: fall back to LDR.
      this.hdr = false;
      this.allocateTargets();
    }
  }

  render(f: FrameData): void {
    const gl = this.gl;
    if (gl.isContextLost() || !this.scene || !this.bloomA || !this.bloomB) return;
    const { camera, world } = f;
    const fog = C.COLORS.fog;

    // ---- scene pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(fog[0], fog[1], fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);

    // Sky
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    const sky = this.sky.use();
    gl.uniform1f(sky.u('uTime'), f.time);
    gl.uniform1f(sky.u('uAspect'), this.width / this.height);
    gl.uniform1f(sky.u('uSunY'), camera.aspect < 1 ? 0.64 : 0.66);
    gl.uniform1f(sky.u('uSunR'), sunRadius(camera.aspect));
    gl.uniform3fv(sky.u('uTop'), C.COLORS.skyTop);
    gl.uniform3fv(sky.u('uHorizon'), fog);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);

    // Ground
    const g = this.setWorldUniforms(this.ground, f);
    gl.uniform1f(g.u('uScroll'), world.distance % 12); // 12 = lcm of all grid periods
    gl.uniform1f(g.u('uLaneWidth'), C.LANE_WIDTH);
    gl.uniform3fv(g.u('uLaneColor'), C.COLORS.lane);
    gl.uniform3fv(g.u('uGridColor'), C.COLORS.grid);
    const p = world.player;
    gl.uniform3f(g.u('uPlayer'), p.x, p.alive ? p.y : 99, p.shield ? 1 : 0);
    gl.uniform1f(g.u('uPulse'), Math.pow(1 - ((f.time * 128) / 60 % 1), 4)); // pulses on the music beat
    gl.bindVertexArray(this.groundVao);
    gl.drawElements(gl.TRIANGLES, this.groundCount, gl.UNSIGNED_SHORT, 0);

    // Boxes: one instanced draw call for every obstacle, pickup and the ship.
    const count = this.fillInstances(world, f.time);
    if (count > 0) {
      const b = this.setWorldUniforms(this.box, f);
      gl.uniform1f(b.u('uTime'), f.time);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData, 0, count * INSTANCE_FLOATS);
      gl.bindVertexArray(this.boxVao);
      gl.drawElementsInstanced(gl.TRIANGLES, this.boxIndexCount, gl.UNSIGNED_SHORT, 0, count);
    }

    // Particles: additive, depth-tested but not depth-writing.
    const n = f.particles.pack(this.particleData);
    if (n > 0) {
      const pp = this.setWorldUniforms(this.particle, f);
      gl.uniform1f(pp.u('uPointScale'), this.height * 0.9);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.particleData, 0, n * PACKED_FLOATS);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.bindVertexArray(this.particleVao);
      gl.drawArrays(gl.POINTS, 0, n);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // ---- bloom
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.emptyVao);
    gl.activeTexture(gl.TEXTURE0);

    this.bindTarget(this.bloomA);
    this.bright.use();
    gl.uniform1i(this.bright.u('uTex'), 0);
    gl.uniform2f(this.bright.u('uTexel'), 1 / this.width, 1 / this.height);
    gl.uniform1f(this.bright.u('uThreshold'), this.hdr ? 0.75 : 0.55);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.blur.use();
    gl.uniform1i(this.blur.u('uTex'), 0);
    for (let i = 0; i < 2; i++) {
      const spread = 1 + i;
      this.bindTarget(this.bloomB);
      gl.uniform2f(this.blur.u('uDir'), spread / this.bloomA.width, 0);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomA.texture);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      this.bindTarget(this.bloomA);
      gl.uniform2f(this.blur.u('uDir'), 0, spread / this.bloomA.height);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomB.texture);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ---- composite to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const c = this.composite.use();
    gl.uniform1i(c.u('uScene'), 0);
    gl.uniform1i(c.u('uBloom'), 1);
    gl.uniform1f(c.u('uBloomStrength'), 1.25);
    gl.uniform1f(c.u('uAberration'), 0.003 + f.aberration);
    gl.uniform1f(c.u('uFlash'), f.flash);
    gl.uniform3fv(c.u('uFlashColor'), f.flashColor);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
  }

  private bindTarget(t: RenderTarget): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, t.fbo);
    this.gl.viewport(0, 0, t.width, t.height);
  }

  private setWorldUniforms(prog: ShaderProgram, f: FrameData): ShaderProgram {
    const gl = this.gl;
    prog.use();
    gl.uniformMatrix4fv(prog.u('uViewProj'), false, f.camera.viewProj);
    gl.uniform3fv(prog.u('uCamPos'), f.camera.eye);
    gl.uniform2fv(prog.u('uCurve'), f.camera.curve);
    gl.uniform3fv(prog.u('uFogColor'), C.COLORS.fog);
    gl.uniform2f(prog.u('uFogRange'), C.FOG_NEAR, C.FOG_FAR);
    return prog;
  }

  private fillInstances(world: FrameData['world'], time: number): number {
    const n = Math.min(collectBoxes(world, time, this.boxes), MAX_INSTANCES);
    const d = this.instanceData;
    for (let i = 0; i < n; i++) {
      const b = this.boxes[i];
      const o = i * INSTANCE_FLOATS;
      d[o] = b.x; d[o + 1] = b.y; d[o + 2] = b.z;
      d[o + 3] = b.rx; d[o + 4] = b.ry; d[o + 5] = b.rz;
      d[o + 6] = b.sx; d[o + 7] = b.sy; d[o + 8] = b.sz;
      d[o + 9] = b.color[0]; d[o + 10] = b.color[1]; d[o + 11] = b.color[2]; d[o + 12] = b.glow;
    }
    return n;
  }
}
