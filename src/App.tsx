/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';

// --- Audio System ---
class AudioManager {
  ctx: AudioContext | null = null;
  gainNode: GainNode | null = null;

  private isPlaying = false;
  private timerId: number | null = null;
  private nextNoteTime = 0;
  private currentNote = 0;
  
  // 4-note classic synthwave/arcade bassline (C2, Eb2, F2, G2)
  private sequence = [65.41, 77.78, 87.31, 98.00]; 
  private tempo = 140; // Beats per minute

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 0.15;
    this.gainNode.connect(this.ctx.destination);
  }

  startAmbientLoop() {
    if (this.isPlaying || !this.ctx) return;
    this.isPlaying = true;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.scheduler();
  }

  stopAmbientLoop() {
    this.isPlaying = false;
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  scheduler = () => {
    if (!this.isPlaying || !this.ctx) return;
    
    // Schedule ahead
    while (this.nextNoteTime < this.ctx.currentTime + 0.1) {
      this.scheduleNote(this.currentNote, this.nextNoteTime);
      this.nextNote();
    }
    this.timerId = window.setTimeout(this.scheduler, 25.0);
  }

  scheduleNote(noteIndex: number, time: number) {
    if (!this.ctx || !this.gainNode) return;
    
    const osc = this.ctx.createOscillator();
    const noteGain = this.ctx.createGain();
    
    osc.type = 'square';
    osc.frequency.value = this.sequence[noteIndex];
    
    // Note duration is an 8th note (half a beat)
    const secondsPerBeat = 60.0 / this.tempo;
    const noteDuration = secondsPerBeat * 0.5 * 0.7; // 70% duty cycle for staccato feel
    
    // Envelope for punchy bass
    noteGain.gain.setValueAtTime(0, time);
    noteGain.gain.linearRampToValueAtTime(0.15, time + 0.01);
    noteGain.gain.setValueAtTime(0.15, time + noteDuration - 0.02);
    noteGain.gain.linearRampToValueAtTime(0, time + noteDuration);

    osc.connect(noteGain);
    noteGain.connect(this.gainNode);
    
    osc.start(time);
    osc.stop(time + noteDuration);
  }

  nextNote() {
    const secondsPerBeat = 60.0 / this.tempo;
    this.nextNoteTime += 0.5 * secondsPerBeat; // 8th note spacing
    this.currentNote++;
    if (this.currentNote >= this.sequence.length) {
      this.currentNote = 0;
    }
  }

  playEat() {
    if (!this.ctx || !this.gainNode) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(400, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
    
    osc.connect(gain);
    gain.connect(this.gainNode);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  playDeath() {
    if (!this.ctx || !this.gainNode) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(20, this.ctx.currentTime + 0.5);
    
    gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
    
    osc.connect(gain);
    gain.connect(this.gainNode);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.5);
  }
}

const audio = new AudioManager();

// --- Constants & Configuration ---
const CANVAS_SIZE = 400; // 400x400 pixels
const GRID_SIZE = 20;    // 20x20 grid cells
const TILE_SIZE = CANVAS_SIZE / GRID_SIZE; // 20px per cell
const BASE_TICK_RATE = 150;
const MIN_TICK_RATE = 50;
const MAX_HAZARDS = 5;
const COMBO_TIME_MS = 3000;

// Map directions to coordinate deltas
const DIRECTIONS = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};

type Point = { x: number; y: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string };
type FloatingText = { x: number; y: number; text: string; life: number; maxLife: number; color?: string };

export default function App() {
  // --- Refs for Mutable Game State ---
  // We use refs instead of state for the core game loop variables to prevent
  // constant re-renders and React hook dependency issues inside requestAnimationFrame.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snakeRef = useRef<Point[]>([{ x: 10, y: 10 }]); // Starting position
  const directionRef = useRef<Point>(DIRECTIONS.RIGHT);
  const nextDirectionRef = useRef<Point>(DIRECTIONS.RIGHT); // Buffers input to prevent 180-degree quick turns
  const foodRef = useRef<Point>({ x: 15, y: 10 });
  const particlesRef = useRef<Particle[]>([]);
  const floatingTextsRef = useRef<FloatingText[]>([]);
  const corruptedSectorsRef = useRef<Point[]>([]);
  const dataPacketRef = useRef<Point | null>(null);
  
  const tickRateRef = useRef<number>(BASE_TICK_RATE);
  const lastEatTimeRef = useRef<number>(0);
  const multiplierRef = useRef<number>(1);
  const boostEndTimeRef = useRef<number>(0);
  const isBoostActiveRef = useRef<boolean>(false);
  const lastTickTime = useRef<number>(0);
  const animationFrameId = useRef<number>(0);

  // --- React State for UI ---
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [isBoostActive, setIsBoostActive] = useState(false);
  const [scoreBump, setScoreBump] = useState(false);

  // --- Game Logic Methods ---

  const getEmptyPosition = () => {
    let newPos;
    let isOccupied = true;
    let attempts = 0;
    while (isOccupied && attempts < 100) {
      newPos = {
        x: Math.floor(Math.random() * GRID_SIZE),
        y: Math.floor(Math.random() * GRID_SIZE),
      };
      // eslint-disable-next-line no-loop-func
      isOccupied = 
        snakeRef.current.some(s => s.x === newPos!.x && s.y === newPos!.y) ||
        corruptedSectorsRef.current.some(s => s.x === newPos!.x && s.y === newPos!.y) ||
        (foodRef.current && foodRef.current.x === newPos!.x && foodRef.current.y === newPos!.y) ||
        (dataPacketRef.current && dataPacketRef.current.x === newPos!.x && dataPacketRef.current.y === newPos!.y);
      attempts++;
    }
    
    // Fallback if random placement fails too many times (e.g. late game)
    if (isOccupied) {
      for (let x = 0; x < GRID_SIZE; x++) {
        for (let y = 0; y < GRID_SIZE; y++) {
          const testPos = { x, y };
          const stillOccupied = 
            snakeRef.current.some(s => s.x === testPos.x && s.y === testPos.y) ||
            corruptedSectorsRef.current.some(s => s.x === testPos.x && s.y === testPos.y) ||
            (foodRef.current && foodRef.current.x === testPos.x && foodRef.current.y === testPos.y) ||
            (dataPacketRef.current && dataPacketRef.current.x === testPos.x && dataPacketRef.current.y === testPos.y);
          if (!stillOccupied) return testPos;
        }
      }
    }
    return newPos as Point;
  };

  const placeFood = () => {
    foodRef.current = getEmptyPosition();
  };

  const resetGame = () => {
    audio.init();
    snakeRef.current = [{ x: 10, y: 10 }];
    directionRef.current = DIRECTIONS.RIGHT;
    nextDirectionRef.current = DIRECTIONS.RIGHT;
    particlesRef.current = [];
    floatingTextsRef.current = [];
    corruptedSectorsRef.current = [];
    dataPacketRef.current = null;
    
    tickRateRef.current = BASE_TICK_RATE;
    lastEatTimeRef.current = performance.now();
    multiplierRef.current = 1;
    boostEndTimeRef.current = 0;
    isBoostActiveRef.current = false;
    
    setIsShaking(false);
    setIsBoostActive(false);
    setScore(0);
    setGameOver(false);
    setIsPaused(false);
    setHasStarted(true);
    placeFood();
    lastTickTime.current = performance.now();
  };

  // --- Input Handling ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Initialize audio on any user interaction
      audio.init();

      // Prevent screen scrolling when using arrow keys or space
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "w", "a", "s", "d"].includes(e.key)) {
        e.preventDefault();
      }

      // Handle pause/unpause
      if (e.key === ' ') {
        if (gameOver) {
          resetGame();
        } else if (hasStarted) {
          setIsPaused((prev) => !prev);
        } else {
          resetGame();
        }
        return;
      }

      if (!hasStarted || gameOver || isPaused) return;

      const { x: dx, y: dy } = directionRef.current;

      // Update nextDirection buffer (keeps us from reversing into ourselves)
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
          if (dy === 0) nextDirectionRef.current = DIRECTIONS.UP;
          break;
        case 'ArrowDown':
        case 's':
          if (dy === 0) nextDirectionRef.current = DIRECTIONS.DOWN;
          break;
        case 'ArrowLeft':
        case 'a':
          if (dx === 0) nextDirectionRef.current = DIRECTIONS.LEFT;
          break;
        case 'ArrowRight':
        case 'd':
          if (dx === 0) nextDirectionRef.current = DIRECTIONS.RIGHT;
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasStarted, gameOver, isPaused]);

  // --- Main Game Loop (Canvas Rendering & State Updates) ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw function (Rendering Phase)
    const draw = () => {
      // 1. Clear the canvas (Classic solid dark background)
      ctx.fillStyle = '#111111'; // Deep charcoal
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Draw Grid (Subtle, using strokeRect)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x < CANVAS_SIZE; x += TILE_SIZE) {
        for (let y = 0; y < CANVAS_SIZE; y += TILE_SIZE) {
          ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);
        }
      }

      // 2. Draw Data Fragment (Pulsing interaction)
      const time = performance.now();
      const pulse = Math.sin(time / 150) * 2;

      ctx.fillStyle = '#fbbf24'; 
      ctx.shadowBlur = 15 + pulse * 3;
      ctx.shadowColor = '#fbbf24';
      ctx.beginPath();
      ctx.arc(
        foodRef.current.x * TILE_SIZE + TILE_SIZE / 2,
        foodRef.current.y * TILE_SIZE + TILE_SIZE / 2,
        (TILE_SIZE - 10) / 2 + pulse / 2,
        0,
        2 * Math.PI
      );
      ctx.fill();
      ctx.shadowBlur = 0;

      // Corrupted Sectors (Red glitch)
      corruptedSectorsRef.current.forEach(sector => {
        ctx.fillStyle = Math.random() > 0.5 ? '#ef4444' : '#b91c1c'; // flicker red
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#ef4444';
        
        const xOfs = (Math.random() - 0.5) * 4;
        const yOfs = (Math.random() - 0.5) * 4;
        
        ctx.fillRect(
          sector.x * TILE_SIZE + 2 + xOfs,
          sector.y * TILE_SIZE + 2 + yOfs,
          TILE_SIZE - 4,
          TILE_SIZE - 4
        );
        ctx.shadowBlur = 0;
      });

      // Encrypted Data Packet (Cyan Pulse)
      if (dataPacketRef.current) {
        const dpPulse = Math.sin(time / 100) * 3;
        ctx.fillStyle = '#22d3ee'; // cyan-400
        ctx.shadowBlur = 15 + dpPulse * 5;
        ctx.shadowColor = '#22d3ee';
        
        ctx.save();
        ctx.translate(
          dataPacketRef.current.x * TILE_SIZE + TILE_SIZE / 2,
          dataPacketRef.current.y * TILE_SIZE + TILE_SIZE / 2
        );
        ctx.rotate(time / 200);
        ctx.fillRect(
          -TILE_SIZE / 3 - dpPulse,
          -TILE_SIZE / 3 - dpPulse,
          (TILE_SIZE / 3 + dpPulse) * 2,
          (TILE_SIZE / 3 + dpPulse) * 2
        );
        ctx.restore();
        ctx.shadowBlur = 0;
      }

      // 3. Draw Snake (Queue structure array)
      snakeRef.current.forEach((segment, index) => {
        // Gradient effect by index, head is brighter green
        ctx.fillStyle = index === 0 ? '#34d399' : '#059669'; // emerald-400 : emerald-600
        
        ctx.shadowBlur = index === 0 ? 20 : 10;
        ctx.shadowColor = '#34d399';

        ctx.fillRect(
          segment.x * TILE_SIZE + 1,
          segment.y * TILE_SIZE + 1,
          TILE_SIZE - 2,
          TILE_SIZE - 2
        );

        if (index === 0) {
          ctx.strokeStyle = "rgba(255,255,255,0.8)";
          ctx.lineWidth = 1;
          ctx.strokeRect(segment.x * TILE_SIZE + 2, segment.y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        }
        
        ctx.shadowBlur = 0;
      });

      // 4. Draw Particles
      particlesRef.current.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.shadowBlur = 8;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, 2 * Math.PI);
        ctx.fill();
      });
      ctx.globalAlpha = 1.0;
      ctx.shadowBlur = 0;

      // 5. Draw Floating Texts
      floatingTextsRef.current.forEach(ft => {
        const color = ft.color || '#34d399';
        ctx.save();
        ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
        ctx.fillStyle = color;
        ctx.font = "bold 16px 'JetBrains Mono', monospace";
        ctx.shadowBlur = 10;
        ctx.shadowColor = color;
        const yOffset = (ft.maxLife - ft.life) * 0.5;
        ctx.fillText(ft.text, ft.x, ft.y - yOffset);
        ctx.restore();
      });
    };

    // Update function (Logic Phase)
    const update = () => {
      if (!hasStarted || gameOver || isPaused) return;

      // Apply the buffered direction
      directionRef.current = nextDirectionRef.current;
      
      const head = snakeRef.current[0];
      const newHead = {
        x: head.x + directionRef.current.x,
        y: head.y + directionRef.current.y,
      };

      // 1. Wall Collision Detection
      if (
        newHead.x < 0 ||
        newHead.x >= GRID_SIZE ||
        newHead.y < 0 ||
        newHead.y >= GRID_SIZE
      ) {
        audio.playDeath();
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 400);
        setGameOver(true);
        return;
      }

      // 2. Self Collision Detection
      if (snakeRef.current.some((segment) => segment.x === newHead.x && segment.y === newHead.y)) {
        audio.playDeath();
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 400);
        setGameOver(true);
        return;
      }

      // 3. Corrupted Sector Collision Detection
      if (corruptedSectorsRef.current.some((sector) => sector.x === newHead.x && sector.y === newHead.y)) {
        audio.playDeath();
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 400);
        setGameOver(true);
        return;
      }

      // Move Snake: push new head (enqueue conceptually to front)
      snakeRef.current.unshift(newHead);

      let addedPoints = 0;
      const currentTime = performance.now();

      // 4. Check Data Fragment / Data Packet Collision
      if (newHead.x === foodRef.current.x && newHead.y === foodRef.current.y) {
        audio.playEat();
        
        // Multiplier logic
        if (currentTime - lastEatTimeRef.current < COMBO_TIME_MS) {
          multiplierRef.current += 1;
        } else {
          multiplierRef.current = 1;
        }
        lastEatTimeRef.current = currentTime;
        
        addedPoints = 10 * multiplierRef.current;
        
        // Dynamic speed ramping
        tickRateRef.current = Math.max(MIN_TICK_RATE, tickRateRef.current - 0.5);

        // Spawn floating text
        floatingTextsRef.current.push({
          x: foodRef.current.x * TILE_SIZE,
          y: foodRef.current.y * TILE_SIZE,
          text: `+${addedPoints}${multiplierRef.current > 1 ? ` x${multiplierRef.current}` : ''}`,
          life: 45,
          maxLife: 45,
          color: '#34d399'
        });

        // Spawn explosion particles
        for (let i = 0; i < 20; i++) {
          particlesRef.current.push({
            x: foodRef.current.x * TILE_SIZE + TILE_SIZE / 2,
            y: foodRef.current.y * TILE_SIZE + TILE_SIZE / 2,
            vx: (Math.random() - 0.5) * 6,
            vy: (Math.random() - 0.5) * 6,
            maxLife: Math.random() * 20 + 20,
            life: Math.random() * 20 + 20,
            color: '#34d399',
          });
        }

        placeFood();

        // Randomly spawn an encrypted data packet (10% chance)
        if (!dataPacketRef.current && Math.random() < 0.10) {
          dataPacketRef.current = getEmptyPosition();
        }

      } else if (dataPacketRef.current && newHead.x === dataPacketRef.current.x && newHead.y === dataPacketRef.current.y) {
        audio.playEat();
        
        // Award massive boost and points
        boostEndTimeRef.current = currentTime + 5000;
        addedPoints = 30 * multiplierRef.current;

        floatingTextsRef.current.push({
          x: dataPacketRef.current.x * TILE_SIZE,
          y: dataPacketRef.current.y * TILE_SIZE,
          text: `+${addedPoints} OVERCLOCK!`,
          life: 60,
          maxLife: 60,
          color: '#22d3ee'
        });

        for (let i = 0; i < 30; i++) {
          particlesRef.current.push({
            x: dataPacketRef.current.x * TILE_SIZE + TILE_SIZE / 2,
            y: dataPacketRef.current.y * TILE_SIZE + TILE_SIZE / 2,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            maxLife: Math.random() * 30 + 20,
            life: Math.random() * 30 + 20,
            color: '#22d3ee',
          });
        }

        dataPacketRef.current = null;
      } else {
        // Didn't eat data fragment, pop the last segment (dequeue from back)
        snakeRef.current.pop();
      }

      if (addedPoints > 0) {
        setScore((s) => {
          const newScore = s + addedPoints;
          setHighScore((hs) => Math.max(hs, newScore));
          
          setScoreBump(true);
          setTimeout(() => setScoreBump(false), 200);

          // Spawn corrupted sectors every 50 points
          if (Math.floor(newScore / 50) > Math.floor(s / 50)) {
            if (corruptedSectorsRef.current.length < MAX_HAZARDS) {
              corruptedSectorsRef.current.push(getEmptyPosition());
            }
          }
          return newScore;
        });
      }
    };

    // Game Loop orchestration
    const gameLoop = (time: number) => {
      // Calculate delta time
      const timeSinceLastTick = time - lastTickTime.current;

      const boostActive = time < boostEndTimeRef.current;
      if (boostActive !== isBoostActiveRef.current) {
        isBoostActiveRef.current = boostActive;
        setIsBoostActive(boostActive);
      }

      const effectiveTickRate = boostActive ? tickRateRef.current * 0.5 : tickRateRef.current;

      // If enough time has passed based on tickRateRef, update game state
      if (timeSinceLastTick >= effectiveTickRate) {
        lastTickTime.current = time;
        update();
      }
      
      // Update particles
      particlesRef.current.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1;
      });
      particlesRef.current = particlesRef.current.filter(p => p.life > 0);

      // Update floating texts
      floatingTextsRef.current.forEach(ft => {
        ft.life -= 1;
      });
      floatingTextsRef.current = floatingTextsRef.current.filter(ft => ft.life > 0);

      // We draw every frame for smoothness even if state hasn't updated yet, 
      // ensuring the canvas stays painted.
      draw();

      animationFrameId.current = requestAnimationFrame(gameLoop);
    };

    // Start Loop
    animationFrameId.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationFrameId.current);
    };
  }, [hasStarted, gameOver, isPaused]); // Re-bind loop if significant state changes

  // Initialize data fragment position safely on mount
  useEffect(() => {
    placeFood();
  }, []);

  // Manage ambient audio loop based on game state
  useEffect(() => {
    if (gameOver || isPaused || !hasStarted) {
      audio.stopAmbientLoop();
    } else {
      audio.startAmbientLoop();
    }
  }, [hasStarted, isPaused, gameOver]);

  return (
    <div className="min-h-screen bg-animated-gradient font-sans text-slate-100 flex flex-col items-center justify-center overflow-hidden selection:bg-emerald-500/30">
      <div className="w-full max-w-[500px] flex flex-col items-center justify-center relative p-8">
        
        {/* Header / Scoreboard */}
        <div className="w-full max-w-[400px] mb-8 flex flex-col sm:flex-row items-center sm:items-start justify-between gap-4">
          <div className="flex flex-col text-center sm:text-left">
            <h1 className="text-2xl font-bold tracking-tighter text-emerald-400 mb-1 italic text-glow-emerald">CLASSIC SNAKE</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">USE ARROW KEYS TO MOVE</p>
          </div>
          <div className="flex gap-4">
            {isBoostActive && (
              <div className="p-3 bg-cyan-950 border border-cyan-800 rounded-lg shadow-inner flex flex-col items-center justify-center min-w-[70px] animate-pulse">
                <span className="text-[10px] text-cyan-500 uppercase font-bold tracking-widest block mb-1">Status</span>
                <span className="text-sm font-bold text-cyan-400 leading-none mt-1 text-glow-cyan">OVR_CLK</span>
              </div>
            )}
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg shadow-inner flex flex-col items-center justify-center min-w-[70px]">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest block mb-1">Score</span>
              <span className={`text-2xl font-mono text-white leading-none text-glow-emerald ${scoreBump ? 'score-bump' : ''}`}>{score.toString().padStart(3, '0')}</span>
            </div>
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg shadow-inner flex flex-col items-center justify-center min-w-[70px]">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest block mb-1">High Score</span>
              <span className="text-2xl font-mono text-emerald-600/50 leading-none">{highScore.toString().padStart(3, '0')}</span>
            </div>
          </div>
        </div>

        {/* Game Canvas Container */}
        <div className={`relative w-full max-w-[400px] aspect-square flex items-center justify-center bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-slate-900 to-slate-950 p-4 sm:p-6 border border-slate-800 shadow-2xl rounded-sm ${isShaking ? 'animate-shake' : ''}`}>
          <div className="relative group w-full h-full">
            {/* Decoration Lines */}
            <div className="absolute -top-4 sm:-top-6 -left-4 sm:-left-6 w-8 sm:w-12 h-8 sm:h-12 border-t-2 border-l-2 border-emerald-500/50"></div>
            <div className="absolute -bottom-4 sm:-bottom-6 -right-4 sm:-right-6 w-8 sm:w-12 h-8 sm:h-12 border-b-2 border-r-2 border-emerald-500/50"></div>
            
            <canvas
              ref={canvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              className="block bg-black w-full h-full border border-slate-800/80 shadow-inner rounded-sm relative z-10"
              style={{ imageRendering: 'pixelated' }}
            />

            {/* Overlays */}
            {(!hasStarted || gameOver || isPaused) && (
              <div className="absolute inset-0 z-20 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 transition-all duration-300">
                {!hasStarted && (
                  <>
                    <h2 className="text-2xl sm:text-3xl font-black text-emerald-500 italic tracking-tighter mb-4 uppercase text-glow-emerald">Ready to Play</h2>
                    <button 
                      onClick={resetGame}
                      className="btn-arcade px-6 py-3 border-2 border-emerald-500 text-emerald-500 hover:text-white transition-all font-bold uppercase tracking-widest text-xs sm:text-sm bg-transparent"
                    >
                      START GAME
                    </button>
                    <p className="text-[10px] text-slate-500 mt-4 font-mono uppercase">Press SPACE to start</p>
                  </>
                )}

                {hasStarted && isPaused && !gameOver && (
                  <>
                    <h2 className="text-2xl sm:text-3xl font-black text-emerald-500 italic tracking-tighter mb-4 uppercase text-glow-emerald">Paused</h2>
                    <button 
                      onClick={() => {
                        audio.init();
                        setIsPaused(false);
                      }}
                      className="btn-arcade px-6 py-3 border-2 border-emerald-500 text-emerald-500 hover:text-white transition-all font-bold uppercase tracking-widest text-xs sm:text-sm bg-transparent"
                    >
                      Resume Game
                    </button>
                    <p className="text-[10px] text-slate-500 mt-4 font-mono uppercase">Press SPACE to resume</p>
                  </>
                )}

                {hasStarted && gameOver && (
                  <>
                    <h2 className="text-2xl sm:text-4xl font-black text-red-500 italic tracking-tighter mb-4 uppercase text-glow-cyan text-red-glow">GAME OVER</h2>
                    <p className="text-slate-500 mb-8 font-mono text-xs">Final Score: <span className="text-emerald-500 font-bold">{score}</span></p>
                    <button 
                      onClick={resetGame}
                      className="btn-arcade px-6 py-3 border-2 border-emerald-500 text-emerald-500 hover:text-white transition-all font-bold uppercase tracking-widest text-xs sm:text-sm bg-transparent"
                    >
                      PLAY AGAIN
                    </button>
                    <p className="text-[10px] text-slate-500 mt-4 font-mono uppercase">Press SPACE to play again</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
