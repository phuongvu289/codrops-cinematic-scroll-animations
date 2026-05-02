'use client';

import { useEffect, useRef, useState } from 'react';
import { Renderer, Camera, Transform, Texture, Program, Mesh, Vec3 } from 'ogl';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CustomEase } from 'gsap/CustomEase';
import { ScrollSmoother } from 'gsap/ScrollSmoother';

import type { CameraAnimation, ParticleMesh } from '@/lib/variant-1/types';
import { images, perspectives, cylinderConfig, particleConfig, imageConfig } from '@/lib/variant-1/data';
import {
  drawImageCover,
  getPositionClasses,
  createCylinderGeometry,
  createParticleGeometry,
} from '@/lib/variant-1/utils';
import { cylinderVertex, cylinderFragment, particleVertex, particleFragment } from '@/lib/variant-1/shaders';
import Loader from '@/components/loader';
import { CodropsFrame } from '@/components/codrops-frame';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, CustomEase, ScrollSmoother);

  CustomEase.create('cinematicSilk', '0.45, 0.05, 0.55, 0.95');
  CustomEase.create('cinematicSmooth', '0.25, 0.1, 0.25, 1');
  CustomEase.create('cinematicFlow', '0.33, 0, 0.2, 1');
  CustomEase.create('cinematicLinear', '0.4, 0, 0.6, 1');
}

export function CylinderCarousel() {
  document.title = 'Cinematic Scroll Animations | Codrops | Demo 1';
  const [isLoading, setIsLoading] = useState(true);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
  const [cursorText, setCursorText] = useState<'Scroll' | 'Drag'>('Scroll');
  const [cursorPos, setCursorPos] = useState({ x: -100, y: -100, visible: false });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const smoothWrapperRef = useRef<HTMLDivElement>(null);
  const smoothContentRef = useRef<HTMLDivElement>(null);
  const textRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rendererRef = useRef<Renderer | null>(null);
  const sceneRef = useRef<Transform | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const cylinderRef = useRef<Mesh | null>(null);
  const cameraAnimRef = useRef<CameraAnimation>({ x: 0, y: 0, z: 8, rotY: 0 });
  const particlesRef = useRef<ParticleMesh[]>([]);
  const lastRotationRef = useRef(0);
  const velocityRef = useRef(0);
  const momentumRef = useRef(0);
  const isAtScrollEndRef = useRef(false);
  const dragStateRef = useRef({ isDragging: false, lastX: 0, pointerId: -1, dragDistance: 0 });
  const dragRotationOffsetRef = useRef(0);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || !smoothWrapperRef.current || !smoothContentRef.current) return;

    const smoother = ScrollSmoother.create({
      wrapper: smoothWrapperRef.current,
      content: smoothContentRef.current,
      smooth: 4,
      effects: false,
      smoothTouch: 0.1,
    });

    const renderer = new Renderer({
      canvas: canvasRef.current,
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: Math.min(window.devicePixelRatio, 2),
      alpha: true,
      antialias: true,
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.disable(gl.CULL_FACE);
    rendererRef.current = renderer;

    const getResponsiveDimensions = () => {
      const width = window.innerWidth;
      const isMobile = width < 768;
      const isTablet = width >= 768 && width < 1024;

      const maxRadius = isMobile ? 1.8 : isTablet ? 2.2 : 2.5;
      const cylinderHeight = isMobile ? 0.8 : isTablet ? 1.0 : 1.2;
      const cameraZ = isMobile ? 6 : isTablet ? 7 : 8;
      const fov = isMobile ? 50 : 45;

      return {
        cylinderScale: maxRadius / cylinderConfig.radius,
        cylinderHeight,
        cameraZ,
        fov,
        isMobile,
      };
    };

    const dimensions = getResponsiveDimensions();

    const cameraOptions: any = { fov: dimensions.fov };
    if (dimensions.isMobile) {
      cameraOptions.aspect = window.innerWidth / window.innerHeight; // Solo en mobile
    }
    const camera = new Camera(gl, cameraOptions);
    camera.position.set(0, 0, dimensions.cameraZ);
    cameraRef.current = camera;

    const scene = new Transform();
    sceneRef.current = scene;

    const geometry = createCylinderGeometry(gl, cylinderConfig);

    const hardwareLimit = gl.getParameter(gl.MAX_TEXTURE_SIZE);

    const isMobileDevice = window.innerWidth < 768;
    const safeLimit = isMobileDevice ? 2048 : Math.min(hardwareLimit, 8192);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', {
      willReadFrequently: false,
      alpha: false
    })!;
    const numImages = images.length;

    const totalWidthOriginal = imageConfig.width * numImages;
    const heightOriginal = imageConfig.height;

    const scale = Math.min(1, safeLimit / totalWidthOriginal);

    canvas.width = Math.floor(totalWidthOriginal * scale);
    canvas.height = Math.floor(heightOriginal * scale);

    let loadedImages = 0;
    const imageElements: HTMLImageElement[] = [];

    const circumference = 2 * Math.PI * cylinderConfig.radius;
    const textureAspectRatio = imageConfig.height / (imageConfig.width * images.length);
    const idealHeight = circumference * textureAspectRatio;
    const heightCorrection = idealHeight / cylinderConfig.height;

    // Store the initial window width to track horizontal changes
    let lastWidth = window.innerWidth;
    let detachDragControls: (() => void) | null = null;

    const handleResize = () => {
      if (rendererRef.current && cameraRef.current && cylinderRef.current) {
        const currentWidth = window.innerWidth;
        const newDimensions = getResponsiveDimensions();

        // 1. Mobile Address Bar Jump Prevention
        // If it's a mobile device and the width hasn't changed, it means only the URL bar hid/showed.
        // I abort the resize here to prevent the camera from zooming in and cropping the cylinder.
        if (newDimensions.isMobile && currentWidth === lastWidth) {
          return;
        }
        lastWidth = currentWidth;

        // Update renderer and camera to actual measurements
        rendererRef.current.setSize(currentWidth, window.innerHeight);

        cameraRef.current.perspective({
          fov: newDimensions.fov,
          aspect: currentWidth / window.innerHeight,
        });

        // 2. Responsive Cylinder Scaling
        // I apply the height correction on mobile to prevent stretched images,
        // but keep the original uncompressed scale for the panoramic desktop look.
        if (newDimensions.isMobile) {
          cylinderRef.current.scale.set(
            newDimensions.cylinderScale,
            newDimensions.cylinderScale * heightCorrection,
            newDimensions.cylinderScale
          );
        } else {
          cylinderRef.current.scale.set(
            newDimensions.cylinderScale,
            newDimensions.cylinderScale,
            newDimensions.cylinderScale
          );
        }

        if (cameraAnimRef.current.z === 8 || cameraAnimRef.current.z === 7 || cameraAnimRef.current.z === 6) {
          cameraAnimRef.current.z = newDimensions.cameraZ;
        }
      }
    };

    images.forEach((imageSrc, index) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imageElements[index] = img;
        loadedImages++;

        const totalCanvasWidth = canvas.width;
        const canvasHeight = canvas.height;

        if (loadedImages === numImages) {
          // Draw all images to canvas
          imageElements.forEach((img, i) => {
            const xStartExact = (i / numImages) * totalCanvasWidth;
            const xEndExact = ((i + 1) / numImages) * totalCanvasWidth;

            const xPos = Math.floor(xStartExact);
            const xEnd = Math.floor(xEndExact);

            const drawWidthActual = xEnd - xPos;
            drawImageCover(
              ctx,
              img,
              xPos,
              0,
              drawWidthActual,
              canvasHeight
            );
          });

          const texture = new Texture(gl, {
            wrapS: gl.CLAMP_TO_EDGE,
            wrapT: gl.CLAMP_TO_EDGE,
            minFilter: gl.LINEAR,
            magFilter: gl.LINEAR,
            generateMipmaps: false
          });

          texture.image = canvas;
          texture.needsUpdate = true;

          const program = new Program(gl, {
            vertex: cylinderVertex,
            fragment: cylinderFragment,
            uniforms: {
              tMap: { value: texture },
              uDarkness: { value: 0.3 },
            },
            cullFace: null,
          });

          const cylinder = new Mesh(gl, { geometry, program });
          cylinder.setParent(scene);
          cylinder.rotation.y = 0.5;
          cylinder.scale.set(dimensions.cylinderScale, dimensions.cylinderScale, dimensions.cylinderScale);
          cylinderRef.current = cylinder;

          setIsLoading(false);

          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: containerRef.current,
              start: 'top top',
              end: 'bottom bottom',
              scrub: 1,
              onUpdate: (self) => {
                isAtScrollEndRef.current = self.progress >= 0.995;
                setCursorText(isAtScrollEndRef.current ? 'Drag' : 'Scroll');
                if (!dragStateRef.current.isDragging && canvasRef.current) {
                  canvasRef.current.style.cursor = isAtScrollEndRef.current ? 'grab' : 'default';
                }
              },
              onLeave: () => {
                isAtScrollEndRef.current = true;
                setCursorText('Drag');
                if (!dragStateRef.current.isDragging && canvasRef.current) {
                  canvasRef.current.style.cursor = 'grab';
                }
              },
              onEnterBack: () => {
                isAtScrollEndRef.current = false;
                setCursorText('Scroll');
                if (!dragStateRef.current.isDragging && canvasRef.current) {
                  canvasRef.current.style.cursor = 'default';
                }
              },
            },
          });

          tl.to(cameraAnimRef.current, {
            x: 0,
            y: 0,
            z: dimensions.cameraZ,
            duration: 1,
            ease: 'cinematicSilk',
          })
            .to(cameraAnimRef.current, {
              x: 0,
              y: 5,
              z: 5,
              duration: 1,
              ease: 'cinematicFlow',
            })
            .to(cameraAnimRef.current, {
              x: 1.5,
              y: 2,
              z: 2,
              duration: 2,
              ease: 'cinematicLinear',
            })
            .to(cameraAnimRef.current, {
              x: 0.5,
              y: 0,
              z: 0.8,
              duration: 3.5,
              ease: 'power1.inOut',
            })
            .to(cameraAnimRef.current, {
              x: -6,
              y: -1,
              z: dimensions.cameraZ,
              duration: 1,
              ease: 'cinematicSmooth',
            });

          tl.to(
            cylinderRef.current.rotation,
            {
              y: '+=28.27',
              duration: 8.5,
              ease: 'none',
            },
            0
          );

          textRefs.current.forEach((textEl, index) => {
            if (!textEl) return;

            const sectionDuration = 100 / perspectives.length;
            const start = index * sectionDuration;
            const end = (index + 1) * sectionDuration;

            const textTimeline = gsap.timeline({
              scrollTrigger: {
                trigger: containerRef.current,
                start: `${start}% top`,
                end: `${end}% top`,
                scrub: 0.8,
              },
            });

            textTimeline
              .fromTo(
                textEl,
                { opacity: 0 },
                {
                  opacity: 1,
                  duration: 0.2,
                  ease: 'cinematicSmooth',
                }
              )
              .to(textEl, {
                opacity: 1,
                duration: 0.6,
                ease: 'none',
              })
              .to(textEl, {
                opacity: 0,
                duration: 0.2,
                ease: 'cinematicSmooth',
              });
          });

          for (let i = 0; i < particleConfig.numParticles; i++) {
            const { geometry: lineGeometry, userData } = createParticleGeometry(
              gl,
              particleConfig,
              i,
              cylinderConfig.height
            );

            const lineProgram = new Program(gl, {
              vertex: particleVertex,
              fragment: particleFragment,
              uniforms: {
                uColor: { value: [1.0, 1.0, 1.0] },
                uOpacity: { value: 0.0 },
              },
              transparent: true,
              depthTest: true,
            });

            const particle = new Mesh(gl, {
              geometry: lineGeometry,
              program: lineProgram,
              mode: gl.LINE_STRIP,
            }) as ParticleMesh;

            particle.userData = userData;
            particle.setParent(scene);
            particlesRef.current.push(particle);
          }

          window.addEventListener('resize', handleResize);

          const getFrontImageIndex = () => {
            const cylinder = cylinderRef.current;
            if (!cylinder) return null;
            const effectiveRotation = cylinder.rotation.y + dragRotationOffsetRef.current;
            const normalizedU = ((((Math.PI / 2 - effectiveRotation) / (Math.PI * 2)) % 1) + 1) % 1;
            return Math.floor(normalizedU * images.length) % images.length;
          };

          const getClosestImageIndexFromPointer = (clientX: number, clientY: number) => {
            const cylinder = cylinderRef.current;
            const cameraInstance = cameraRef.current;
            if (!cylinder || !cameraInstance) return null;

            cameraInstance.updateMatrixWorld();
            const cameraPos = cameraInstance.worldPosition;
            const scaleX = cylinder.scale.x || 1;
            const scaleY = cylinder.scale.y || 1;
            const scaleZ = cylinder.scale.z || 1;
            const radiusWorld = cylinderConfig.radius * ((scaleX + scaleZ) * 0.5);
            const heightWorld = cylinderConfig.height * scaleY;
            const effectiveRotation = cylinder.rotation.y + dragRotationOffsetRef.current;
            const sampleOffsetsU = [0.15, 0.5, 0.85];
            const sampleOffsetsV = [0.2, 0.5, 0.8];
            let bestIndex: number | null = null;
            let bestDistance = Number.POSITIVE_INFINITY;

            for (let i = 0; i < images.length; i++) {
              for (let mapping = 0; mapping < 2; mapping++) {
                for (const sampleOffsetU of sampleOffsetsU) {
                  const localAngle = ((i + sampleOffsetU) / images.length) * Math.PI * 2;
                  const worldAngle = mapping === 0 ? effectiveRotation + localAngle : effectiveRotation - localAngle;
                  const normal = new Vec3(Math.cos(worldAngle), 0, Math.sin(worldAngle));

                  for (const sampleOffsetV of sampleOffsetsV) {
                    const y = (sampleOffsetV - 0.5) * heightWorld;
                    const point = new Vec3(Math.cos(worldAngle) * radiusWorld, y, Math.sin(worldAngle) * radiusWorld);
                    const toCamera = new Vec3(cameraPos[0] - point[0], cameraPos[1] - point[1], cameraPos[2] - point[2]);
                    if (normal.dot(toCamera) <= 0) continue;

                    cameraInstance.project(point);
                    if (point[2] < -1 || point[2] > 1) continue;

                    const sx = (point[0] * 0.5 + 0.5) * window.innerWidth;
                    const sy = (1 - (point[1] * 0.5 + 0.5)) * window.innerHeight;
                    const dist = Math.hypot(sx - clientX, sy - clientY);
                    if (dist < bestDistance) {
                      bestDistance = dist;
                      bestIndex = i;
                    }
                  }
                }
              }
            }

            return bestIndex ?? getFrontImageIndex();
          };

          const handlePointerDown = (event: PointerEvent) => {
            if (!isAtScrollEndRef.current || !cylinderRef.current) return;
            dragStateRef.current.isDragging = true;
            dragStateRef.current.lastX = event.clientX;
            dragStateRef.current.pointerId = event.pointerId;
            dragStateRef.current.dragDistance = 0;
            momentumRef.current = 0;
            document.body.style.cursor = 'grabbing';
            event.preventDefault();
          };

          const handlePointerMove = (event: PointerEvent) => {
            if (!dragStateRef.current.isDragging || dragStateRef.current.pointerId !== event.pointerId) return;
            const deltaX = event.clientX - dragStateRef.current.lastX;
            dragStateRef.current.lastX = event.clientX;
            dragStateRef.current.dragDistance += Math.abs(deltaX);

            const dragRotation = deltaX * 0.01;
            dragRotationOffsetRef.current += dragRotation;
            velocityRef.current = dragRotation;
            momentumRef.current = 0;
          };

          const handlePointerUp = (event: PointerEvent) => {
            if (dragStateRef.current.pointerId !== event.pointerId) return;
            const wasClick = dragStateRef.current.dragDistance < 8;
            dragStateRef.current.isDragging = false;
            dragStateRef.current.pointerId = -1;
            momentumRef.current = 0;
            document.body.style.cursor = isAtScrollEndRef.current ? 'grab' : 'default';

            if (wasClick && isAtScrollEndRef.current) {
              const index = getClosestImageIndexFromPointer(event.clientX, event.clientY);
              if (index !== null) setSelectedImageIndex(index);
            }
          };

          window.addEventListener('pointerdown', handlePointerDown);
          window.addEventListener('pointermove', handlePointerMove);
          window.addEventListener('pointerup', handlePointerUp);
          window.addEventListener('pointercancel', handlePointerUp);

          const handleCursorMove = (event: PointerEvent) => {
            setCursorPos({ x: event.clientX, y: event.clientY, visible: true });
          };
          const handleCursorLeave = () => {
            setCursorPos((prev) => ({ ...prev, visible: false }));
          };

          window.addEventListener('pointermove', handleCursorMove);
          window.addEventListener('pointerleave', handleCursorLeave);

          detachDragControls = () => {
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);
            window.removeEventListener('pointermove', handleCursorMove);
            window.removeEventListener('pointerleave', handleCursorLeave);
            document.body.style.cursor = 'default';
          };

          const animate = () => {
            requestAnimationFrame(animate);

            camera.position.set(cameraAnimRef.current.x, cameraAnimRef.current.y, cameraAnimRef.current.z);
            camera.lookAt([0, 0, 0]);

            if (cylinderRef.current) {
              cylinderRef.current.rotation.y += dragRotationOffsetRef.current;
              dragRotationOffsetRef.current = 0;
              const currentRotation = cylinderRef.current.rotation.y;
              velocityRef.current = currentRotation - lastRotationRef.current;
              lastRotationRef.current = currentRotation;

              const inertiaFactor = 0.15;
              const decayFactor = 0.92;

              momentumRef.current = momentumRef.current * decayFactor + velocityRef.current * inertiaFactor;

              const speed = Math.abs(velocityRef.current) * 100;

              const isRotating = Math.abs(velocityRef.current) > 0.0001;

              // Update particles
              particlesRef.current.forEach((particle) => {
                const userData = particle.userData;

                const targetOpacity = isRotating ? Math.min(speed * 3, 0.95) : 0;
                const currentOpacity = particle.program.uniforms.uOpacity.value as number;
                particle.program.uniforms.uOpacity.value = currentOpacity + (targetOpacity - currentOpacity) * 0.15;

                if (isRotating) {
                  const rotationOffset = velocityRef.current * userData.speed * 1.5;
                  const newBaseAngle = userData.baseAngle + rotationOffset;
                  userData.baseAngle = newBaseAngle;

                  const segments = particleConfig.segments;
                  const positions = particle.geometry.attributes.position.data as Float32Array;

                  for (let j = 0; j <= segments; j++) {
                    const t = j / segments;
                    const angle = newBaseAngle + userData.angleSpan * t;
                    const radiusWithSpeed = userData.radius;

                    positions[j * 3] = Math.cos(angle) * radiusWithSpeed;
                    positions[j * 3 + 1] = userData.baseY;
                    positions[j * 3 + 2] = Math.sin(angle) * radiusWithSpeed;
                  }

                  particle.geometry.attributes.position.needsUpdate = true;
                }
              });
            }

            renderer.render({ scene, camera });
          };
          animate();
        }
      };
      img.onerror = () => {
        console.error('Failed to load image:', imageSrc);
        setIsLoading(false);
      };
      img.src = imageSrc;
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      smoother.kill();
      detachDragControls?.();
    };
  }, []);

  return (
    <>
      <Loader isLoading={isLoading} className="bg-[#000]" classNameLoader="bg-[#fff]" />

      <CodropsFrame
        demoTitle="Cinematic 3D Scroll Experiences with GSAP"
        articleUrl="https://tympanus.net/codrops/?p=103299"
        githubUrl="https://github.com/JosephASG/codrops-cinematic-scroll-animations"
        demos={[
          { label: 'Demo 1', href: '/', current: true },
          { label: 'Demo 2', href: '/variant-2', current: false },
        ]}
        tags={['gsap', 'ogl', 'webgl', 'scroll', '3d']}
      />

      <div className="fixed inset-0 w-full h-svh z-0">
        <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />
      </div>

      <div
        className={`fixed z-[80] pointer-events-none px-3 py-1 rounded-full border border-white/30 bg-black/70 text-white text-xs tracking-wider uppercase transition-opacity duration-150 ${
          cursorPos.visible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          left: cursorPos.x + 14,
          top: cursorPos.y + 14,
          transform: 'translate3d(0,0,0)',
        }}
      >
        {cursorText}
      </div>

      <div className="fixed inset-0 pointer-events-none z-10 text-white">
        {perspectives.map((perspective, index) => (
          <div
            key={index}
            ref={(el) => {
              textRefs.current[index] = el;
            }}
            className={`absolute text-center opacity-0 max-md:w-full ${getPositionClasses(perspective.position)}`}
          >
            <h2 className="text-7xl font-[300] max-md:text-3xl leading-[0.8]">{perspective.title}</h2>
            <p className="text-2xl font-[300] max-md:text-base opacity-50 mt-2">{perspective.description}</p>
          </div>
        ))}
      </div>

      <div className="fixed bottom-8 right-8 z-10 pointer-events-none">
        <div className="flex flex-col items-center gap-2 animate-bounce">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-white/60"
          >
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
          <span className="text-m text-white/40">Scroll</span>
        </div>
      </div>

      <div ref={smoothWrapperRef} id="smooth-wrapper" className="relative z-20">
        <div ref={smoothContentRef} id="smooth-content">
          <div ref={containerRef} style={{ height: '500svh' }} />
        </div>
      </div>

      {selectedImageIndex !== null && (
        <div className="fixed inset-y-0 right-0 w-[min(92vw,420px)] bg-black/90 border-l border-white/10 z-[70] p-5 text-white">
          <button
            type="button"
            onClick={() => setSelectedImageIndex(null)}
            className="mb-4 text-sm text-white/70 hover:text-white"
          >
            Close
          </button>
          <img
            src={images[selectedImageIndex]}
            alt={`Selected scene ${selectedImageIndex + 1}`}
            className="w-full h-auto rounded-md object-cover mb-4"
          />
          <p className="text-sm text-white/70">Scene {selectedImageIndex + 1}</p>
        </div>
      )}
    </>
  );
}
