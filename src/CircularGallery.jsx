import { Camera, Mesh, Plane, Program, Renderer, Texture, Transform } from 'ogl';
import { useEffect, useMemo, useRef } from 'react';
import { categories } from './shared/seedData.js';
import './CircularGallery.css';

// ── Canvas → card texture ─────────────────────────────────────
const CARD_BGS = ['#1e1e1c', '#232320', '#272522', '#1b1b19', '#212120'];

function galleryCardKey(card) {
  return card ? `${card.nodeId}:${card.id}` : '';
}

function wrapCanvasText(ctx, text, maxWidth, maxLines = 6) {
  const source = String(text || '');
  const lines = [];
  let current = '';
  for (const char of source) {
    const next = current + char;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = char;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && lines[lines.length - 1].length > 1 && source.length > lines.join('').length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)}…`;
  }
  return lines;
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const lines = wrapCanvasText(ctx, text, maxWidth, maxLines);
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  return lines.length * lineHeight;
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function cardToDataURL(card, { faceState = 'front', selected = false, detailResult = null } = {}) {
  const W = 700, H = 900;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const isDetail = selected && faceState === 'detail' && detailResult;
  const isQuestion = selected && faceState === 'question';
  const nodeLabel = card.nodeLabel || card.label || 'Review Card';

  ctx.fillStyle = isDetail ? '#f7f7f4' : CARD_BGS[nodeLabel.charCodeAt(0) % CARD_BGS.length];
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = isDetail ? 'rgba(0,0,0,0.08)' : selected ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.06)';
  ctx.lineWidth = selected ? 5 : 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  const cat = categories[card.category] || categories.new;
  const font = '-apple-system, "PingFang SC", "Helvetica Neue", sans-serif';

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (isDetail) {
    const resultLabel = detailResult.isCorrect ? 'Mastered' : 'Missed';
    ctx.fillStyle = detailResult.isCorrect ? '#111111' : '#4a4a4a';
    drawRoundRect(ctx, 248, 72, 204, 58, 29);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 30px ${font}`;
    ctx.fillText(resultLabel, W / 2, 101);

    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.font = `bold 24px ${font}`;
    ctx.fillText(cat.label, W / 2, 180);

    ctx.fillStyle = '#111111';
    ctx.font = `bold ${nodeLabel.length > 10 ? 42 : 50}px ${font}`;
    drawWrappedText(ctx, nodeLabel, W / 2, 255, W - 110, 62, 3);

    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.font = `30px ${font}`;
    drawWrappedText(ctx, card.answer, W / 2, 480, W - 120, 43, 4);

    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.font = `24px ${font}`;
    drawWrappedText(ctx, card.desc, W / 2, 694, W - 130, 34, 3);

    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.font = `24px ${font}`;
    ctx.fillText('Details on the right', W / 2, H - 72);
    return canvas.toDataURL('image/png');
  }

  ctx.font = `bold 30px ${font}`;
  ctx.fillStyle = cat.color || '#888888';
  ctx.fillText(cat.label, W / 2, 110);

  if (isQuestion) {
    ctx.fillStyle = 'rgba(240, 239, 237, 0.42)';
    ctx.font = `26px ${font}`;
    ctx.fillText('Answer the question', W / 2, 195);

    ctx.fillStyle = 'rgba(240, 239, 237, 0.96)';
    ctx.font = `bold 44px ${font}`;
    drawWrappedText(ctx, card.question, W / 2, 330, W - 110, 60, 5);

    ctx.fillStyle = 'rgba(240,239,237,0.24)';
    ctx.font = `26px ${font}`;
    ctx.fillText('Enter your answer on the right', W / 2, H - 88);
    return canvas.toDataURL('image/png');
  }

  const fontSize = nodeLabel.length > 10 ? 50 : nodeLabel.length > 6 ? 58 : 68;
  ctx.font = `bold ${fontSize}px ${font}`;
  ctx.fillStyle = 'rgba(240, 239, 237, 0.95)';

  const maxW = W - 100;
  const lineH = fontSize * 1.45;
  const lines = wrapCanvasText(ctx, nodeLabel, maxW, 4);
  const blockH = lines.length * lineH;
  const startY = H / 2 - blockH / 2 + lineH / 2;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, startY + i * lineH));

  // Bottom hint.
  ctx.fillStyle = 'rgba(240,239,237,0.18)';
  ctx.font = `26px ${font}`;
  ctx.fillText('Click to review', W / 2, H - 88);

  return canvas.toDataURL('image/png');
}

// ── OGL utilities ─────────────────────────────────────────────
function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}
const lerp = (a, b, t) => a + (b - a) * t;

function autoBind(inst) {
  Object.getOwnPropertyNames(Object.getPrototypeOf(inst)).forEach(k => {
    if (k !== 'constructor' && typeof inst[k] === 'function') inst[k] = inst[k].bind(inst);
  });
}

// ── Media (single card) ───────────────────────────────────────
class Media {
  constructor({ geometry, gl, image, index, length, renderer, scene, screen, viewport, bend, borderRadius }) {
    this.extra = 0;
    Object.assign(this, { geometry, gl, image, index, length, renderer, scene, screen, viewport, bend, borderRadius });
    this.createShader();
    this.createMesh();
    this.onResize();
  }

  createShader() {
    const texture = new Texture(this.gl, { generateMipmaps: true });
    this.program = new Program(this.gl, {
      depthTest: false, depthWrite: false,
      vertex: `
        precision highp float;
        attribute vec3 position; attribute vec2 uv;
        uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
        uniform float uTime; uniform float uSpeed;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.z = (sin(p.x * 4.0 + uTime) * 1.5 + cos(p.y * 2.0 + uTime) * 1.5) * (0.1 + uSpeed * 0.5);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragment: `
        precision highp float;
        uniform vec2 uImageSizes; uniform vec2 uPlaneSizes;
        uniform sampler2D tMap; uniform float uBorderRadius;
        varying vec2 vUv;
        float roundedBoxSDF(vec2 p, vec2 b, float r) {
          vec2 d = abs(p) - b;
          return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0) - r;
        }
        void main() {
          vec2 ratio = vec2(
            min((uPlaneSizes.x / uPlaneSizes.y) / (uImageSizes.x / uImageSizes.y), 1.0),
            min((uPlaneSizes.y / uPlaneSizes.x) / (uImageSizes.y / uImageSizes.x), 1.0)
          );
          vec2 uv = vec2(vUv.x * ratio.x + (1.0 - ratio.x) * 0.5, vUv.y * ratio.y + (1.0 - ratio.y) * 0.5);
          vec4 color = texture2D(tMap, uv);
          float d = roundedBoxSDF(vUv - 0.5, vec2(0.5 - uBorderRadius), uBorderRadius);
          float alpha = 1.0 - smoothstep(-0.002, 0.002, d);
          gl_FragColor = vec4(color.rgb, alpha);
        }`,
      uniforms: {
        tMap: { value: texture },
        uPlaneSizes: { value: [0, 0] },
        uImageSizes: { value: [0, 0] },
        uSpeed: { value: 0 },
        uTime: { value: 100 * Math.random() },
        uBorderRadius: { value: this.borderRadius },
      },
      transparent: true,
    });

    const img = new Image();
    img.src = this.image;
    img.onload = () => {
      texture.image = img;
      this.program.uniforms.uImageSizes.value = [img.naturalWidth, img.naturalHeight];
    };
  }

  createMesh() {
    this.plane = new Mesh(this.gl, { geometry: this.geometry, program: this.program });
    this.plane.setParent(this.scene);
  }

  update(scroll, direction) {
    this.plane.position.x = this.x - scroll.current - this.extra;
    const x = this.plane.position.x;
    const H = this.viewport.width / 2;

    if (this.bend === 0) {
      this.plane.position.y = 0;
      this.plane.rotation.z = 0;
    } else {
      const R = (H * H + this.bend * this.bend) / (2 * Math.abs(this.bend));
      const ex = Math.min(Math.abs(x), H);
      const arc = R - Math.sqrt(R * R - ex * ex);
      if (this.bend > 0) {
        this.plane.position.y = -arc;
        this.plane.rotation.z = -Math.sign(x) * Math.asin(ex / R);
      } else {
        this.plane.position.y = arc;
        this.plane.rotation.z = Math.sign(x) * Math.asin(ex / R);
      }
    }

    this.speed = scroll.current - scroll.last;
    this.program.uniforms.uTime.value += 0.04;
    this.program.uniforms.uSpeed.value = this.speed;

    const planeOffset = this.plane.scale.x / 2;
    const vpOffset = this.viewport.width / 2;
    this.isBefore = this.plane.position.x + planeOffset < -vpOffset;
    this.isAfter = this.plane.position.x - planeOffset > vpOffset;
    if (direction === 'right' && this.isBefore) { this.extra -= this.widthTotal; this.isBefore = this.isAfter = false; }
    if (direction === 'left' && this.isAfter) { this.extra += this.widthTotal; this.isBefore = this.isAfter = false; }
  }

  onResize({ screen, viewport } = {}) {
    if (screen) this.screen = screen;
    if (viewport) this.viewport = viewport;
    this.scale = this.screen.height / 1500;
    this.plane.scale.y = (this.viewport.height * (900 * this.scale)) / this.screen.height;
    this.plane.scale.x = (this.viewport.width * (700 * this.scale)) / this.screen.width;
    this.program.uniforms.uPlaneSizes.value = [this.plane.scale.x, this.plane.scale.y];
    this.padding = 2;
    this.width = this.plane.scale.x + this.padding;
    this.widthTotal = this.width * this.length;
    this.x = this.width * this.index;
  }
}

// ── App (OGL controller) ──────────────────────────────────────
class App {
  constructor(container, { items, bend, borderRadius, scrollSpeed, scrollEase, selectedIndex = 0, onSelect, onDeselect }) {
    this.container = container;
    this.items = items;           // Original card count.
    this.onSelect = onSelect;
    this.onDeselect = onDeselect;
    this.scrollSpeed = scrollSpeed;
    this.scroll = { ease: scrollEase, current: 0, target: 0, last: 0 };
    this.dragStartX = 0;
    this.isDragging = false;
    autoBind(this);
    this.onCheckDebounce = debounce(this.onCheck, 200);
    this.createRenderer();
    this.createCamera();
    this.createScene();
    this.onResize();
    this.createGeometry();
    this.createMedias(items, bend, borderRadius);
    this.centerOnIndex(selectedIndex);
    this.update();
    this.addEventListeners();
  }

  createRenderer() {
    this.renderer = new Renderer({ alpha: true, antialias: true, dpr: Math.min(window.devicePixelRatio || 1, 2) });
    this.gl = this.renderer.gl;
    this.gl.clearColor(0, 0, 0, 0);
    this.container.appendChild(this.gl.canvas);
  }
  createCamera() {
    this.camera = new Camera(this.gl);
    this.camera.fov = 45;
    this.camera.position.z = 20;
  }
  createScene() { this.scene = new Transform(); }
  createGeometry() {
    this.planeGeometry = new Plane(this.gl, { heightSegments: 50, widthSegments: 100 });
  }

  createMedias(items, bend, borderRadius) {
    const doubled = items.concat(items);
    this.medias = doubled.map((data, index) => new Media({
      geometry: this.planeGeometry, gl: this.gl,
      image: data.image, index, length: doubled.length,
      renderer: this.renderer, scene: this.scene,
      screen: this.screen, viewport: this.viewport,
      bend, borderRadius,
    }));
  }

  centerOnIndex(index) {
    if (!this.medias?.[0]) return;
    const safeIndex = Math.max(0, Math.min(this.items.length - 1, Number(index) || 0));
    const target = this.medias[0].width * safeIndex;
    this.scroll.current = target;
    this.scroll.target = target;
    this.scroll.last = target;
  }

  // Find the currently centered card index in the original array.
  getCenteredIndex() {
    if (!this.medias || !this.medias[0] || !this.items.length) return 0;
    const width = this.medias[0].width;
    const raw = Math.round(Math.abs(this.scroll.current) / width);
    return raw % this.items.length;
  }

  getPointerClient(e) {
    if (e.changedTouches?.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    if (e.touches?.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  getPointerViewportPoint(e) {
    const point = this.getPointerClient(e);
    const rect = this.container.getBoundingClientRect();
    return {
      x: ((point.x - rect.left) / rect.width - 0.5) * this.viewport.width,
      y: -((point.y - rect.top) / rect.height - 0.5) * this.viewport.height,
    };
  }

  getMediaAtPointer(e) {
    if (!this.medias?.length || !this.viewport) return null;
    const point = this.getPointerViewportPoint(e);
    const visibleMedias = this.medias.filter((media) => {
      const x = media.plane.position.x;
      const y = media.plane.position.y;
      const halfWidth = media.plane.scale.x * 0.72;
      const halfHeight = media.plane.scale.y * 0.72;
      return Math.abs(point.x - x) <= halfWidth && Math.abs(point.y - y) <= halfHeight;
    });
    if (!visibleMedias.length) return null;
    return visibleMedias.reduce((best, media) => {
      const bestDistance = Math.hypot(point.x - best.plane.position.x, point.y - best.plane.position.y);
      const distance = Math.hypot(point.x - media.plane.position.x, point.y - media.plane.position.y);
      return distance < bestDistance ? media : best;
    });
  }

  snapToMedia(media) {
    if (!media) return;
    this.scroll.target = media.x - media.extra;
    this.onCheckDebounce();
  }

  onTouchDown(e) {
    if (!this.container.contains(e.target)) return;
    this.isDown = true;
    this.isDragging = false;
    this.scroll.position = this.scroll.current;
    this.dragStartX = this.getPointerClient(e).x;
    this.start = this.dragStartX;
  }
  onTouchMove(e) {
    if (!this.isDown) return;
    const x = this.getPointerClient(e).x;
    if (Math.abs(x - this.dragStartX) > 6) this.isDragging = true;
    const dist = (this.start - x) * (this.scrollSpeed * 0.025);
    this.scroll.target = this.scroll.position + dist;
  }
  onTouchUp(e) {
    if (!this.isDown) return;
    this.isDown = false;
    if (!this.isDragging) {
      const media = this.getMediaAtPointer(e);
      if (media) {
        this.snapToMedia(media);
        this.onSelect?.(media.index % this.items.length);
      } else {
        this.onDeselect?.();
      }
    }
    this.isDragging = false;
    this.onCheck();
  }
  onWheel(e) {
    if (!this.container.contains(e.target)) return;
    e.preventDefault();
    const delta = e.deltaY || e.wheelDelta || e.detail;
    this.scroll.target += (delta > 0 ? this.scrollSpeed : -this.scrollSpeed) * 0.2;
    this.onCheckDebounce();
  }
  onCheck() {
    if (!this.medias || !this.medias[0]) return;
    const width = this.medias[0].width;
    const idx = Math.round(Math.abs(this.scroll.target) / width);
    const snap = width * idx;
    this.scroll.target = this.scroll.target < 0 ? -snap : snap;
  }
  onResize() {
    this.screen = { width: this.container.clientWidth, height: this.container.clientHeight };
    this.renderer.setSize(this.screen.width, this.screen.height);
    this.camera.perspective({ aspect: this.screen.width / this.screen.height });
    const fov = (this.camera.fov * Math.PI) / 180;
    const h = 2 * Math.tan(fov / 2) * this.camera.position.z;
    this.viewport = { width: h * this.camera.aspect, height: h };
    this.medias?.forEach(m => m.onResize({ screen: this.screen, viewport: this.viewport }));
  }
  update() {
    this.scroll.current = lerp(this.scroll.current, this.scroll.target, this.scroll.ease);
    const direction = this.scroll.current > this.scroll.last ? 'right' : 'left';
    this.medias?.forEach(m => m.update(this.scroll, direction));
    this.renderer.render({ scene: this.scene, camera: this.camera });
    this.scroll.last = this.scroll.current;
    this.raf = window.requestAnimationFrame(this.update);
  }
  addEventListeners() {
    window.addEventListener('resize', this.onResize);
    this.container.addEventListener('wheel', this.onWheel, { passive: false });
    this.container.addEventListener('mousewheel', this.onWheel, { passive: false });
    this.container.addEventListener('mousedown', this.onTouchDown);
    window.addEventListener('mousemove', this.onTouchMove);
    window.addEventListener('mouseup', this.onTouchUp);
    this.container.addEventListener('touchstart', this.onTouchDown);
    window.addEventListener('touchmove', this.onTouchMove);
    window.addEventListener('touchend', this.onTouchUp);
  }
  destroy() {
    window.cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.container.removeEventListener('wheel', this.onWheel);
    this.container.removeEventListener('mousewheel', this.onWheel);
    this.container.removeEventListener('mousedown', this.onTouchDown);
    window.removeEventListener('mousemove', this.onTouchMove);
    window.removeEventListener('mouseup', this.onTouchUp);
    this.container.removeEventListener('touchstart', this.onTouchDown);
    window.removeEventListener('touchmove', this.onTouchMove);
    window.removeEventListener('touchend', this.onTouchUp);
    this.renderer?.gl?.canvas?.parentNode?.removeChild(this.renderer.gl.canvas);
  }
}

// ── React component ───────────────────────────────────────────
export default function CircularGallery({
  cards = [],
  selectedCardKey = '',
  faceState = 'front',
  detailResult = null,
  onSelect,
  onDeselect,
  bend = 2,
  borderRadius = 0.06,
  scrollSpeed = 2,
  scrollEase = 0.05,
}) {
  const containerRef = useRef(null);

  const items = useMemo(
    () =>
      cards.map((card) => {
        const key = galleryCardKey(card);
        const selected = Boolean(selectedCardKey && key === selectedCardKey);
        return {
          key,
          image: cardToDataURL(card, {
            selected,
            faceState: selected ? faceState : 'front',
            detailResult: selected ? detailResult : null,
          }),
        };
      }),
    [cards, detailResult, faceState, selectedCardKey],
  );

  const selectedIndex = useMemo(() => {
    const index = cards.findIndex((card) => galleryCardKey(card) === selectedCardKey);
    return index >= 0 ? index : 0;
  }, [cards, selectedCardKey]);

  useEffect(() => {
    if (!containerRef.current || !items.length) return;
    const app = new App(containerRef.current, {
      items,
      bend,
      borderRadius,
      scrollSpeed,
      scrollEase,
      selectedIndex,
      onSelect: (idx) => onSelect?.(cards[idx]),
      onDeselect,
    });
    return () => app.destroy();
  }, [items, bend, borderRadius, scrollSpeed, scrollEase, selectedIndex, onSelect, onDeselect, cards]);

  return <div className="circular-gallery" ref={containerRef} />;
}
