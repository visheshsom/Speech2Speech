// VoiceOrb.jsx

import { useRef, useEffect } from 'react';

const STATE_PALETTES = {
  idle: {
    inner: ['#FFE0A0', '#FF9933', '#CC4400', '#661100'],
    rings: 'rgba(255, 153, 51, ',
    bars: null,
  },
  connecting: {
    inner: ['#FFE0A0', '#FF9933', '#CC4400', '#661100'],
    rings: 'rgba(255, 153, 51, ',
    bars: null,
  },
  listening: {
    inner: ['#A0F0FF', '#00CCFF', '#0055DD', '#001177'],
    rings: 'rgba(0, 180, 255, ',
    bars: null,
  },
  speaking: {
    inner: ['#FFE870', '#FFAA00', '#FF4400', '#880022'],
    rings: 'rgba(255, 120, 0, ',
    bars: { from: '#FFDD44', to: '#FF5500' },
  },
};

export default function VoiceOrb({ state, analyser }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const clockRef = useRef(0);
  const alphaRef = useRef(0); // smooth color transition

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const DPR = window.devicePixelRatio || 1;

    // Hi-DPI canvas
    const size = 480;
    canvas.width = size * DPR;
    canvas.height = size * DPR;
    ctx.scale(DPR, DPR);

    const CX = size / 2;
    const CY = size / 2;
    const BASE_R = size * 0.255;

    function getFreq() {
      if (!analyser) return { avg: 0, bass: 0, mid: 0, high: 0, raw: new Uint8Array(64) };
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
      const bass = data.slice(0, 6).reduce((a, b) => a + b, 0) / 6 / 255;
      const mid = data.slice(6, 28).reduce((a, b) => a + b, 0) / 22 / 255;
      const high = data.slice(28, 64).reduce((a, b) => a + b, 0) / 36 / 255;
      return { avg, bass, mid, high, raw: data };
    }

    function lerp(a, b, t) { return a + (b - a) * t; }

    function drawFrame(t) {
      ctx.clearRect(0, 0, size, size);
      const f = getFreq();
      const pal = STATE_PALETTES[state] ?? STATE_PALETTES.idle;
      const isListening = state === 'listening';
      const isSpeaking = state === 'speaking';
      const isIdle = state === 'idle';
      const isConnecting = state === 'connecting';

      // Breathing / connect pulse
      const breathe = Math.sin(t * 0.9) * 0.025;
      const pulse = isConnecting ? Math.abs(Math.sin(t * 3)) * 0.06 : 0;

      // ── Outer glow halos ──────────────────────────────────────
      const halos = isSpeaking ? 3 : isListening ? 2 : 1;
      for (let h = halos - 1; h >= 0; h--) {
        const hR = BASE_R * (1.45 + h * 0.32 + f.bass * 0.55);
        const hA = (0.12 - h * 0.035) * (isSpeaking ? (0.7 + Math.sin(t * 2.5 + h) * 0.3) : 1);
        const hG = ctx.createRadialGradient(CX, CY, hR * 0.55, CX, CY, hR);
        hG.addColorStop(0, `${pal.rings}${hA.toFixed(3)})`);
        hG.addColorStop(1, `${pal.rings}0)`);
        ctx.beginPath();
        ctx.arc(CX, CY, hR, 0, Math.PI * 2);
        ctx.fillStyle = hG;
        ctx.fill();
      }

      // ── Morphing blob shape ───────────────────────────────────
      const N = 160;
      const points = [];

      for (let i = 0; i < N; i++) {
        const θ = (i / N) * Math.PI * 2;
        const fi = Math.floor((i / N) * f.raw.length);
        const fv = f.raw[fi] / 255;

        let r = BASE_R * (1 + breathe + pulse);

        if (isSpeaking) {
          r += BASE_R * (
            Math.sin(θ * 3 + t * 2.3) * 0.08 * (1 + f.bass * 2.2) +
            Math.sin(θ * 5 - t * 1.9) * 0.05 * (1 + f.mid * 1.8) +
            Math.sin(θ * 8 + t * 3.4) * 0.03 * (1 + f.high * 1.5) +
            fv * 0.18 * (f.bass + 0.3)
          );
        } else if (isListening) {
          r += BASE_R * (
            Math.sin(θ * 4 + t * 3.5) * 0.055 * (1 + f.avg * 1.5) +
            Math.sin(θ * 2 - t * 2.1) * 0.035
          );
        } else if (isConnecting) {
          r += BASE_R * Math.sin(θ * 3 + t * 4) * 0.045;
        } else {
          r += BASE_R * Math.sin(θ * 2 + t * 0.6) * 0.02;
        }

        points.push({ x: CX + Math.cos(θ) * r, y: CY + Math.sin(θ) * r });
      }

      // Smooth curve through blob points
      ctx.beginPath();
      ctx.moveTo(
        (points[N - 1].x + points[0].x) / 2,
        (points[N - 1].y + points[0].y) / 2
      );
      for (let i = 0; i < N; i++) {
        const curr = points[i];
        const next = points[(i + 1) % N];
        ctx.quadraticCurveTo(curr.x, curr.y, (curr.x + next.x) / 2, (curr.y + next.y) / 2);
      }
      ctx.closePath();

      // Fill gradient
      const fg = ctx.createRadialGradient(
        CX - BASE_R * 0.25, CY - BASE_R * 0.25, BASE_R * 0.05,
        CX, CY, BASE_R * 1.5
      );
      const c = pal.inner;
      fg.addColorStop(0, c[0]);
      fg.addColorStop(0.35, c[1]);
      fg.addColorStop(0.65, c[2]);
      fg.addColorStop(1, c[3]);
      ctx.fillStyle = fg;
      ctx.fill();

      // Specular highlight (top-left shine)
      const sg = ctx.createRadialGradient(
        CX - BASE_R * 0.35, CY - BASE_R * 0.35, 0,
        CX, CY, BASE_R * 0.95
      );
      sg.addColorStop(0, 'rgba(255,255,255,0.40)');
      sg.addColorStop(0.4, 'rgba(255,255,255,0.06)');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fill();

      // ── Frequency bars (speaking only) ───────────────────────
      if (isSpeaking && pal.bars) {
        const barCount = 64;
        for (let i = 0; i < barCount; i++) {
          const θ = (i / barCount) * Math.PI * 2 - Math.PI / 2;
          const fi = Math.floor((i / barCount) * f.raw.length);
          const fv = f.raw[fi] / 255;
          const barLen = BASE_R * 0.55 * fv;
          if (barLen < 1.5) continue;

          const innerR = BASE_R * 1.12;
          ctx.beginPath();
          ctx.moveTo(CX + Math.cos(θ) * innerR, CY + Math.sin(θ) * innerR);
          ctx.lineTo(CX + Math.cos(θ) * (innerR + barLen), CY + Math.sin(θ) * (innerR + barLen));
          ctx.strokeStyle = `rgba(255, ${130 + Math.round(fv * 110)}, 20, ${(0.55 + fv * 0.45).toFixed(2)})`;
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      }

      // ── Connecting spinner ────────────────────────────────────
      if (isConnecting) {
        const arcR = BASE_R * 1.38;
        ctx.beginPath();
        ctx.arc(CX, CY, arcR, t * 2, t * 2 + Math.PI * 1.2);
        ctx.strokeStyle = 'rgba(255, 180, 80, 0.7)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // ── Listening ripple rings ─────────────────────────────────
      if (isListening) {
        const ripples = 3;
        for (let r = 0; r < ripples; r++) {
          const phase = ((t * 0.6 + r / ripples) % 1);
          const rR = BASE_R * (1.05 + phase * 0.85);
          const rA = (1 - phase) * 0.18;
          ctx.beginPath();
          ctx.arc(CX, CY, rR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0, 200, 255, ${rA.toFixed(3)})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    function loop() {
      clockRef.current += 0.016;
      drawFrame(clockRef.current);
      rafRef.current = requestAnimationFrame(loop);
    }

    loop();
    return () => cancelAnimationFrame(rafRef.current);
  }, [state, analyser]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        filter: 'drop-shadow(0 0 40px rgba(255,140,30,0.25))',
      }}
    />
  );
}
