/**
 * ZeroCast - Ultra-Low Latency Wireless Screen Sharing & Casting Engine
 * Features:
 * - Direct P2P WebRTC over local UDP with Google STUN unmasking
 * - Hardware acceleration + zero jitter buffering (playoutDelayHint = 0)
 * - True bidirectional casting: Device A to Device B, and Device B to Device A
 * - Clear separation of Broadcaster and Receiver (no recursive self-mirroring!)
 * - Real-time glass-to-glass latency & telemetry HUD
 * - Reverse touch/pointer input backchannel
 */

class ZeroCast {
  constructor() {
    this.ws = null;
    this.pc = null;
    this.dataChannel = null;
    this.localStream = null;
    this.role = null; // 'sender' | 'receiver'
    this.room = 'default-room';
    this.clientId = null;
    this.isStreaming = false;
    this.pendingIceCandidates = [];

    // Latency & clock sync state
    this.clockOffset = 0;
    this.rtt = 0;
    this.statsInterval = null;
    this.lastStats = null;
    this.frameCount = 0;
    this.benchmarkActive = false;
    this.viewerCount = 0;

    // DOM Elements
    this.dom = {
      connectionPill: document.getElementById('connectionPill'),
      connectionText: document.getElementById('connectionText'),
      modeSelection: document.getElementById('modeSelection'),
      broadcasterPanel: document.getElementById('broadcasterPanel'),
      localPreviewVideo: document.getElementById('localPreviewVideo'),
      senderViewerCount: document.getElementById('senderViewerCount'),
      senderRoomDisplay: document.getElementById('senderRoomDisplay'),
      senderFpsDisplay: document.getElementById('senderFpsDisplay'),
      senderBitrateDisplay: document.getElementById('senderBitrateDisplay'),
      senderShareUrl: document.getElementById('senderShareUrl'),
      btnCopySenderUrl: document.getElementById('btnCopySenderUrl'),
      btnViewBroadcastFullscreen: document.getElementById('btnViewBroadcastFullscreen'),
      btnStopBroadcasting: document.getElementById('btnStopBroadcasting'),
      displayContainer: document.getElementById('displayContainer'),
      remoteVideo: document.getElementById('remoteVideo'),
      receiverWaiting: document.getElementById('receiverWaiting'),
      waitingRoomName: document.getElementById('waitingRoomName'),
      btnCancelReceive: document.getElementById('btnCancelReceive'),
      statsHud: document.getElementById('statsHud'),
      benchmarkTimer: document.getElementById('benchmarkTimer'),
      benchmarkTimeVal: document.getElementById('benchmarkTimeVal'),
      benchmarkFrameCount: document.getElementById('benchmarkFrameCount'),
      displayLanUrl: document.getElementById('displayLanUrl'),
      btnStartBroadcast: document.getElementById('btnStartBroadcast'),
      btnStartReceive: document.getElementById('btnStartReceive'),
      btnStopStream: document.getElementById('btnStopStream'),
      btnToggleStats: document.getElementById('btnToggleStats'),
      btnCloseHud: document.getElementById('btnCloseHud'),
      btnFullscreen: document.getElementById('btnFullscreen'),
      btnToggleAudio: document.getElementById('btnToggleAudio'),
      btnFitMode: document.getElementById('btnFitMode'),
      btnZoomIn: document.getElementById('btnZoomIn'),
      btnZoomOut: document.getElementById('btnZoomOut'),
      btnZoomReset: document.getElementById('btnZoomReset'),
      zoomLevelDisplay: document.getElementById('zoomLevelDisplay'),
      btnToggleBenchmark: document.getElementById('btnToggleBenchmark'),
      btnCopyUrl: document.getElementById('btnCopyUrl'),
      selectFps: document.getElementById('selectFps'),
      selectBitrate: document.getElementById('selectBitrate'),
      chkAudio: document.getElementById('chkAudio'),
      txtRoomCode: document.getElementById('txtRoomCode'),
      chkLowLatencyBoost: document.getElementById('chkLowLatencyBoost'),
      chkRemoteInput: document.getElementById('chkRemoteInput'),
      // Telemetry fields
      statRtt: document.getElementById('statRtt'),
      statGlassToGlass: document.getElementById('statGlassToGlass'),
      statFps: document.getElementById('statFps'),
      statResolution: document.getElementById('statResolution'),
      statBitrate: document.getElementById('statBitrate'),
      statJitter: document.getElementById('statJitter'),
      statPacketsLost: document.getElementById('statPacketsLost'),
      statPlayoutDelay: document.getElementById('statPlayoutDelay')
    };

    this.fitModes = ['contain', 'cover', 'fill', 'zoom-game'];
    this.currentFitIndex = 0;
    this.zoomLevel = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.startX = 0;
    this.startY = 0;

    // Audio streaming & independent mute state
    this.isMuted = false;
    this.audioCtx = null;
    this.audioGainNode = null;
    this.nextAudioTime = 0;

    this.init();
  }

  init() {
    this.bindEvents();
    this.displayLanUrl();
    this.autoDetectMode();
  }

  displayLanUrl() {
    const loc = window.location;
    const url = `${loc.protocol}//${loc.host}/?room=${this.room}&mode=receiver`;
    if (this.dom.displayLanUrl) this.dom.displayLanUrl.textContent = url;
    if (this.dom.senderShareUrl) this.dom.senderShareUrl.textContent = url;
  }

  autoDetectMode() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('room')) {
      this.room = params.get('room');
      if (this.dom.txtRoomCode) this.dom.txtRoomCode.value = this.room;
      this.displayLanUrl();
    }
    const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry/i.test(navigator.userAgent) || window.innerWidth <= 768;
    if (isMobile) {
      document.body.classList.add('is-mobile');
      const rcvTitle = document.getElementById('cardReceiveTitle');
      const rcvDesc = document.getElementById('cardReceiveDesc');
      const rcvBtnText = document.getElementById('btnStartReceiveText');
      const bcastTitle = document.getElementById('cardBroadcastTitle');
      const bcastDesc = document.getElementById('cardBroadcastDesc');

      if (rcvTitle) rcvTitle.textContent = 'Watch Laptop Screen';
      if (rcvDesc) rcvDesc.textContent = 'View your laptop screen in real-time on this phone with zero buffer delay.';
      if (rcvBtnText) rcvBtnText.textContent = 'Watch Laptop Screen Now';
      if (bcastTitle) bcastTitle.textContent = 'Cast Phone to Laptop';
      if (bcastDesc) bcastDesc.textContent = 'To cast this phone\'s screen to your laptop, Android requires the native ZeroCast app:';
    }

    if (params.get('mode') === 'receiver') {
      console.log('⚡ Auto-starting in Receiver mode from URL parameter...');
      setTimeout(() => {
        this.startReceive();
      }, 400);
    }
  }

  bindEvents() {
    this.dom.btnStartBroadcast.addEventListener('click', () => this.startBroadcast());
    this.dom.btnStartReceive.addEventListener('click', () => this.startReceive());
    this.dom.btnStopStream.addEventListener('click', () => this.stopStream());
    this.dom.btnStopBroadcasting.addEventListener('click', () => this.stopStream());
    this.dom.btnCancelReceive.addEventListener('click', () => this.stopStream());

    if (this.dom.btnViewBroadcastFullscreen) {
      this.dom.btnViewBroadcastFullscreen.addEventListener('click', () => {
        if (this.localStream) {
          this.dom.broadcasterPanel.classList.add('hidden');
          this.dom.displayContainer.classList.remove('hidden');
          this.dom.remoteVideo.srcObject = this.localStream;
          this.dom.remoteVideo.muted = true;
          this.dom.remoteVideo.play().catch(e => console.log(e));
        }
      });
    }
    
    this.dom.btnToggleStats.addEventListener('click', () => this.toggleStatsHud());
    this.dom.btnCloseHud.addEventListener('click', () => this.toggleStatsHud(false));
    this.dom.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
    this.dom.btnFitMode.addEventListener('click', () => this.cycleFitMode());
    this.dom.btnToggleBenchmark.addEventListener('click', () => this.toggleBenchmarkTimer());

    if (this.dom.btnCopyUrl) {
      this.dom.btnCopyUrl.addEventListener('click', () => {
        navigator.clipboard.writeText(this.dom.displayLanUrl.textContent);
        this.dom.btnCopyUrl.textContent = 'Copied!';
        setTimeout(() => { this.dom.btnCopyUrl.textContent = 'Copy'; }, 2000);
      });
    }

    if (this.dom.btnCopySenderUrl) {
      this.dom.btnCopySenderUrl.addEventListener('click', () => {
        navigator.clipboard.writeText(this.dom.senderShareUrl.textContent);
        this.dom.btnCopySenderUrl.textContent = 'Copied!';
        setTimeout(() => { this.dom.btnCopySenderUrl.textContent = 'Copy Link'; }, 2000);
      });
    }

    this.dom.btnToggleAudio.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleAudio();
    });

    // Tap/Click anywhere on display container to resume audio if suspended by browser policy
    this.dom.displayContainer.addEventListener('click', () => {
      this.initAudioContext();
    });

    this.setupZoomAndPan();
    this.setupTouchInputRelay();
  }

  updateStatus(state, text) {
    this.dom.connectionPill.className = `status-pill status-${state}`;
    this.dom.connectionText.textContent = text;
  }

  connectSignaling() {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.updateStatus('connected', 'Signaling Connected');
        this.ws.send(JSON.stringify({
          type: 'join',
          room: this.room,
          role: this.role
        }));
        resolve();
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket Error:', err);
        this.updateStatus('error', 'Signaling Error');
        reject(err);
      };

      this.ws.onmessage = async (event) => {
        if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
          this.handlePhoneScreenBinary(event.data);
          return;
        }
        try {
          const msg = JSON.parse(event.data);
          this.handleSignalingMessage(msg);
        } catch (e) {
          // ignore
        }
      };

      this.ws.onclose = () => {
        this.updateStatus('disconnected', 'Disconnected');
      };
    });
  }

  async handleSignalingMessage(msg) {
    switch (msg.type) {
      case 'joined':
        this.clientId = msg.clientId;
        if (msg.peerCount && msg.peerCount > 1) {
          this.viewerCount = msg.peerCount - 1;
          this.updateViewerCount();
        }
        break;

      case 'peer-joined':
        this.viewerCount++;
        this.updateViewerCount();
        if (this.role === 'sender' && this.isStreaming) {
          // Send offer to newly joined receiver
          console.log('Peer joined, creating WebRTC offer...');
          this.createAndSendOffer();
        }
        break;

      case 'request-offer':
        if (this.role === 'sender' && this.isStreaming) {
          console.log('Receiver requested offer, sending...');
          this.createAndSendOffer();
        }
        break;

      case 'offer':
        if (this.role === 'receiver') {
          console.log('Received offer from sender...');
          await this.handleOffer(msg.payload);
        }
        break;

      case 'answer':
        if (this.role === 'sender') {
          console.log('Received answer from receiver...');
          await this.handleAnswer(msg.payload);
        }
        break;

      case 'candidate':
        if (this.pc && msg.payload) {
          if (this.pc.remoteDescription && this.pc.remoteDescription.type) {
            try {
              await this.pc.addIceCandidate(new RTCIceCandidate(msg.payload));
            } catch (e) {
              console.warn('Error adding ICE candidate:', e);
            }
          } else {
            this.pendingIceCandidates.push(msg.payload);
          }
        }
        break;

      case 'peer-left':
        this.viewerCount = Math.max(0, this.viewerCount - 1);
        this.updateViewerCount();
        break;
    }
  }

  updateViewerCount() {
    if (this.dom.senderViewerCount) {
      if (this.viewerCount > 0) {
        this.dom.senderViewerCount.textContent = `🟢 ${this.viewerCount} Connected`;
        this.dom.senderViewerCount.style.borderColor = 'var(--accent-green)';
        this.dom.senderViewerCount.style.color = 'var(--accent-green)';
      } else {
        this.dom.senderViewerCount.textContent = 'Waiting for viewer to connect...';
        this.dom.senderViewerCount.style.borderColor = 'rgba(0, 240, 255, 0.3)';
        this.dom.senderViewerCount.style.color = 'var(--accent-cyan)';
      }
    }
  }

  createPeerConnection() {
    // STUN servers guarantee candidate unmasking across Android, Windows, Mac, Linux
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };

    this.localIceCandidates = [];

    this.pc = new RTCPeerConnection(config);

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.localIceCandidates.push(event.candidate);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'candidate',
            room: this.room,
            payload: event.candidate
          }));
        }
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log('WebRTC Connection State:', this.pc.connectionState);
      if (this.pc.connectionState === 'connected') {
        this.updateStatus('streaming', 'P2P Stream Active');
        if (this.dom.receiverWaiting) this.dom.receiverWaiting.classList.add('hidden');
        this.startTelemetryStats();
      } else if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
        this.updateStatus('error', 'Disconnected');
      }
    };

    return this.pc;
  }

  // --- SENDER / BROADCASTER PIPELINE ---
  async startBroadcast() {
    this.role = 'sender';
    this.room = this.dom.txtRoomCode.value.trim() || 'default-room';
    const targetFps = parseInt(this.dom.selectFps.value, 10);
    const targetBitrate = parseInt(this.dom.selectBitrate.value, 10);
    const includeAudio = this.dom.chkAudio.checked;

    // Mobile web browser check
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      alert(
        "📱 Mobile Browser Restriction:\n\n" +
        "Android Chrome and iOS Safari block screen broadcasting inside web browsers for OS security.\n\n" +
        "• To view your PC screen on this phone, tap 'Watch Laptop Screen'!\n" +
        "• To broadcast from this phone to PC, install and use the ZeroCast APK (ZeroCast.apk)."
      );
      this.updateStatus('disconnected', 'Ready');
      return;
    }

    let stream = null;
    try {
      this.updateStatus('connected', 'Selecting Screen...');
      
      const constraints = {
        video: {
          frameRate: { ideal: targetFps, max: targetFps }
        }
      };
      if (includeAudio) {
        constraints.audio = {
          suppressLocalAudioPlayback: false
        };
      }

      try {
        stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      } catch (firstErr) {
        console.warn('Initial getDisplayMedia attempt:', firstErr);
        // If user simply closed/cancelled picker without audio, cleanly exit
        if (!includeAudio) {
          console.log('User cancelled screen selection dialog.');
          this.updateStatus('disconnected', 'Ready');
          return;
        }

        // If audio was requested, fallback to video-only capture
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: targetFps, max: targetFps } }
          });
        } catch (fallbackErr) {
          console.log('Fallback capture cancelled or failed:', fallbackErr);
          this.updateStatus('disconnected', 'Ready');
          return;
        }
      }

      if (!stream) {
        this.updateStatus('disconnected', 'Ready');
        return;
      }

      this.localStream = stream;

      this.localStream.getVideoTracks()[0].onended = () => {
        this.stopStream();
      };

      await this.connectSignaling();
      this.createPeerConnection();

      // DataChannel for zero-delay remote input & clock sync
      this.dataChannel = this.pc.createDataChannel('control', {
        ordered: false,
        maxRetransmits: 0
      });
      this.setupDataChannel(this.dataChannel);

      // Add local capture tracks to peer connection
      this.localStream.getTracks().forEach(track => {
        if (track.kind === 'video') {
          // CRITICAL: Tells Chromium to prioritize immediate frame delivery over text smoothing
          track.contentHint = 'motion';
        }

        const sender = this.pc.addTrack(track, this.localStream);
        if (track.kind === 'video') {
          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          params.encodings[0].maxBitrate = targetBitrate * 1000;
          params.encodings[0].maxFramerate = targetFps;
          params.encodings[0].networkPriority = 'high';
          params.encodings[0].priority = 'high';
          sender.setParameters(params).catch(e => console.warn('setParameters error:', e));

          // Prioritize hardware H.264 codecs for sub-25ms mobile decoding
          if (RTCRtpSender.getCapabilities) {
            const capabilities = RTCRtpSender.getCapabilities('video');
            if (capabilities && capabilities.codecs) {
              const h264 = capabilities.codecs.filter(c => c.mimeType.toLowerCase() === 'video/h264');
              const others = capabilities.codecs.filter(c => c.mimeType.toLowerCase() !== 'video/h264');
              const sorted = [...h264, ...others];
              const transceivers = this.pc.getTransceivers();
              const vt = transceivers.find(t => t.sender === sender);
              if (vt && vt.setCodecPreferences) {
                try {
                  vt.setCodecPreferences(sorted);
                  console.log('⚡ Prioritized H.264 hardware encoding for minimal latency');
                } catch (e) {
                  console.warn('setCodecPreferences error:', e);
                }
              }
            }
          }
        }
      });

      this.isStreaming = true;

      // Update UI: SENDER SHOWS BROADCASTER DASHBOARD
      this.dom.modeSelection.classList.add('hidden');
      this.dom.broadcasterPanel.classList.remove('hidden');
      this.dom.displayContainer.classList.add('hidden');

      // Local preview
      this.dom.localPreviewVideo.srcObject = this.localStream;
      this.dom.localPreviewVideo.muted = true;
      this.dom.localPreviewVideo.play().catch(e => console.log('Preview play error:', e));

      this.dom.senderRoomDisplay.textContent = this.room;
      this.dom.senderFpsDisplay.textContent = `${targetFps} FPS`;
      this.dom.senderBitrateDisplay.textContent = `${(targetBitrate / 1000).toFixed(0)} Mbps`;
      this.displayLanUrl();

      this.startBenchmarkClock();

      // Send initial offer
      await this.createAndSendOffer();

    } catch (err) {
      console.error('Error starting broadcast:', err);
      this.updateStatus('disconnected', 'Ready');
    }
  }

  async createAndSendOffer() {
    if (!this.pc) return;
    try {
      const offer = await this.pc.createOffer({
        offerToReceiveVideo: false,
        offerToReceiveAudio: false
      });

      await this.pc.setLocalDescription(offer);

      this.ws.send(JSON.stringify({
        type: 'offer',
        room: this.room,
        payload: offer
      }));

      // Immediately transmit any already gathered ICE candidates to the receiver
      if (this.localIceCandidates && this.localIceCandidates.length > 0) {
        for (const cand of this.localIceCandidates) {
          this.ws.send(JSON.stringify({
            type: 'candidate',
            room: this.room,
            payload: cand
          }));
        }
      }
    } catch (e) {
      console.error('createAndSendOffer error:', e);
    }
  }

  async handleAnswer(answer) {
    if (!this.pc) return;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
      this.flushPendingCandidates();
    } catch (e) {
      console.error('handleAnswer error:', e);
    }
  }

  // --- RECEIVER PIPELINE ---
  async startReceive() {
    this.role = 'receiver';
    this.room = this.dom.txtRoomCode.value.trim() || 'default-room';

    try {
      this.updateStatus('connected', 'Connecting to Stream...');
      await this.connectSignaling();
      this.createPeerConnection();

      // DataChannel listener
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel(this.dataChannel);
      };

      // Inbound track listener (RECEIVES SCREEN FROM BROADCASTER!)
      this.pc.ontrack = (event) => {
        console.log('⚡ Received remote track:', event.track.kind);
        if (this.dom.receiverWaiting) this.dom.receiverWaiting.classList.add('hidden');

        if (event.streams && event.streams[0]) {
          this.dom.remoteVideo.srcObject = event.streams[0];
        } else {
          const inboundStream = new MediaStream([event.track]);
          this.dom.remoteVideo.srcObject = inboundStream;
        }

        // Apply zero-delay buffer bypass
        const boostEnabled = this.dom.chkLowLatencyBoost.checked;
        this.applyZeroBufferPlayout(boostEnabled);
        this.dom.remoteVideo.onplaying = () => {
          this.applyZeroBufferPlayout(boostEnabled);
        };

        // Crucial for Android/iOS mobile browsers: ensure muted for unprompted autoplay!
        this.dom.remoteVideo.muted = true;
        this.dom.remoteVideo.play().catch(e => {
          console.warn('Playback retry muted:', e);
          this.dom.remoteVideo.muted = true;
          this.dom.remoteVideo.play().catch(err => console.error('Final play failure:', err));
        });
      };

      this.isStreaming = true;

      // Update UI: RECEIVER SHOWS FULLSCREEN VIDEO VIEWPORT
      this.dom.modeSelection.classList.add('hidden');
      this.dom.broadcasterPanel.classList.add('hidden');
      this.dom.displayContainer.classList.remove('hidden');
      if (this.dom.receiverWaiting) this.dom.receiverWaiting.classList.remove('hidden');
      if (this.dom.waitingRoomName) this.dom.waitingRoomName.textContent = this.room;

      // Notify sender that receiver is ready and waiting for offer
      this.ws.send(JSON.stringify({
        type: 'request-offer',
        room: this.room
      }));

    } catch (err) {
      console.error('Error connecting as receiver:', err);
      alert('Could not connect as receiver: ' + err.message);
      this.updateStatus('disconnected', 'Ready');
    }
  }

  applyZeroBufferPlayout(enabled) {
    if (!this.pc) return;
    const hint = enabled ? 0.0 : 0.05;
    this.pc.getReceivers().forEach(receiver => {
      if (receiver.track && receiver.track.kind === 'video') {
        if ('playoutDelayHint' in receiver) {
          receiver.playoutDelayHint = hint;
          console.log(`⚡ Set video receiver playoutDelayHint to ${hint * 1000} ms`);
        }
        if ('jitterBufferTarget' in receiver) {
          receiver.jitterBufferTarget = hint;
        }
      }
    });
    if (this.dom.statPlayoutDelay) {
      this.dom.statPlayoutDelay.textContent = `${(hint * 1000).toFixed(0)} ms`;
    }
  }

  async handleOffer(offer) {
    if (!this.pc) this.createPeerConnection();

    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      this.flushPendingCandidates();

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      this.ws.send(JSON.stringify({
        type: 'answer',
        room: this.room,
        payload: answer
      }));

      this.applyZeroBufferPlayout(this.dom.chkLowLatencyBoost.checked);
    } catch (e) {
      console.error('handleOffer error:', e);
    }
  }

  async flushPendingCandidates() {
    while (this.pendingIceCandidates.length > 0) {
      const cand = this.pendingIceCandidates.shift();
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.warn('Deferred ICE candidate error:', e);
      }
    }
  }

  // --- SDP LOW-LATENCY TUNING ---
  mungeSdp(sdp, bitrateKbps) {
    let lines = sdp.split('\r\n');
    let mVideoIndex = lines.findIndex(l => l.startsWith('m=video'));
    if (mVideoIndex === -1) return sdp;

    const bLine = `b=AS:${bitrateKbps}`;
    const tiasLine = `b=TIAS:${bitrateKbps * 1000}`;
    lines.splice(mVideoIndex + 1, 0, bLine, tiasLine);

    lines = lines.map(line => {
      if (line.startsWith('a=fmtp:')) {
        return `${line};x-google-min-bitrate=15000;x-google-max-bitrate=${bitrateKbps}`;
      }
      return line;
    });

    return lines.join('\r\n');
  }

  // --- DATA CHANNEL & INPUT RELAY ---
  setupDataChannel(dc) {
    dc.onopen = () => {
      console.log('⚡ High-Speed DataChannel Open');
      this.startClockSync();
    };

    dc.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'clock-ping') {
          dc.send(JSON.stringify({
            type: 'clock-pong',
            senderTime: data.time,
            receiverTime: performance.now()
          }));
        } else if (data.type === 'clock-pong') {
          const now = performance.now();
          const rtt = now - data.senderTime;
          this.rtt = rtt;
          if (this.dom.statRtt) this.dom.statRtt.textContent = `${rtt.toFixed(1)} ms`;
          const estGlass = (rtt / 2) + 10;
          if (this.dom.statGlassToGlass) this.dom.statGlassToGlass.textContent = `~${estGlass.toFixed(1)} ms`;
        }
      } catch (e) {}
    };
  }

  startClockSync() {
    setInterval(() => {
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.dataChannel.send(JSON.stringify({
          type: 'clock-ping',
          time: performance.now()
        }));
      }
    }, 1000);
  }

  setupTouchInputRelay() {
    const video = this.dom.remoteVideo;
    video.addEventListener('pointerdown', (e) => {
      if (this.role !== 'receiver' || !this.dom.chkRemoteInput.checked) return;
      if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;

      const rect = video.getBoundingClientRect();
      const normX = (e.clientX - rect.left) / rect.width;
      const normY = (e.clientY - rect.top) / rect.height;

      this.dataChannel.send(JSON.stringify({
        type: 'input-pointer',
        action: 'down',
        x: normX,
        y: normY,
        button: e.button
      }));
    });
  }

  // --- TELEMETRY & STATS MONITOR ---
  startTelemetryStats() {
    if (this.statsInterval) clearInterval(this.statsInterval);

    this.statsInterval = setInterval(async () => {
      if (!this.pc) return;

      const stats = await this.pc.getStats();
      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          if (this.lastStats) {
            const timeDiff = (report.timestamp - this.lastStats.timestamp) / 1000;
            const bytesDiff = report.bytesReceived - this.lastStats.bytesReceived;
            const mbps = (bytesDiff * 8) / (timeDiff * 1000000);
            if (this.dom.statBitrate) this.dom.statBitrate.textContent = `${mbps.toFixed(1)} Mbps`;
          }

          if (report.framesPerSecond && this.dom.statFps) {
            this.dom.statFps.textContent = `${report.framesPerSecond} FPS`;
          }
          if (report.frameWidth && report.frameHeight && this.dom.statResolution) {
            this.dom.statResolution.textContent = `${report.frameWidth}x${report.frameHeight}`;
          }
          if (report.jitter !== undefined && this.dom.statJitter) {
            this.dom.statJitter.textContent = `${(report.jitter * 1000).toFixed(1)} ms`;
          }
          if (report.packetsLost !== undefined && this.dom.statPacketsLost) {
            this.dom.statPacketsLost.textContent = report.packetsLost;
          }

          this.lastStats = report;
        }

        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          if (report.framesPerSecond && this.dom.statFps) {
            this.dom.statFps.textContent = `${report.framesPerSecond} FPS`;
          }
          if (report.frameWidth && report.frameHeight && this.dom.statResolution) {
            this.dom.statResolution.textContent = `${report.frameWidth}x${report.frameHeight}`;
          }
        }
      });
    }, 1000);
  }

  startBenchmarkClock() {
    this.benchmarkActive = true;
    if (this.dom.benchmarkTimer) this.dom.benchmarkTimer.classList.remove('hidden');

    const updateClock = () => {
      if (!this.benchmarkActive) return;

      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      const ms = String(now.getMilliseconds()).padStart(3, '0');

      if (this.dom.benchmarkTimeVal) this.dom.benchmarkTimeVal.textContent = `${h}:${m}:${s}.${ms}`;
      if (this.dom.benchmarkFrameCount) this.dom.benchmarkFrameCount.textContent = `Frame: ${++this.frameCount}`;

      requestAnimationFrame(updateClock);
    };

    requestAnimationFrame(updateClock);
  }

  toggleBenchmarkTimer() {
    this.benchmarkActive = !this.benchmarkActive;
    if (this.dom.benchmarkTimer) this.dom.benchmarkTimer.classList.toggle('hidden', !this.benchmarkActive);
    if (this.benchmarkActive) this.startBenchmarkClock();
  }

  toggleStatsHud(forceState) {
    const isHidden = this.dom.statsHud.classList.contains('hidden');
    const newState = forceState !== undefined ? !forceState : isHidden;
    this.dom.statsHud.classList.toggle('hidden', !newState);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(e => console.log(e));
    } else {
      document.exitFullscreen();
    }
  }

  cycleFitMode() {
    this.currentFitIndex = (this.currentFitIndex + 1) % this.fitModes.length;
    const mode = this.fitModes[this.currentFitIndex];
    const canvas = document.getElementById('phoneCanvas');

    if (mode === 'zoom-game') {
      this.dom.remoteVideo.className = 'fit-contain';
      if (canvas) canvas.className = 'fit-contain';
      this.setZoom(2.5, true);
      this.dom.btnFitMode.querySelector('span').textContent = 'Fit: ZOOM GAME (2.5x)';
    } else {
      this.setZoom(1.0, true);
      this.dom.remoteVideo.className = `fit-${mode}`;
      if (canvas) canvas.className = `fit-${mode}`;
      const labels = {
        contain: 'Fit: CONTAIN',
        cover: 'Fit: COVER (FILL)',
        fill: 'Fit: STRETCH'
      };
      this.dom.btnFitMode.querySelector('span').textContent = labels[mode] || `Fit: ${mode.toUpperCase()}`;
    }
  }

  applyTransform() {
    const transformStr = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
    if (this.dom.remoteVideo) {
      this.dom.remoteVideo.style.transform = transformStr;
    }
    const canvas = document.getElementById('phoneCanvas');
    if (canvas) {
      canvas.style.transform = transformStr;
    }
    if (this.dom.zoomLevelDisplay) {
      this.dom.zoomLevelDisplay.textContent = `${Math.round(this.zoomLevel * 100)}%`;
    }
    if (this.dom.displayContainer) {
      this.dom.displayContainer.classList.toggle('can-pan', this.zoomLevel > 1.01);
    }
  }

  setZoom(level, resetPan = false) {
    this.zoomLevel = Math.max(1.0, Math.min(4.0, Math.round(level * 100) / 100));
    if (this.zoomLevel <= 1.01 || resetPan) {
      this.panX = 0;
      this.panY = 0;
    }
    this.applyTransform();
  }

  setupZoomAndPan() {
    const container = this.dom.displayContainer;
    if (!container) return;

    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      this.setZoom(this.zoomLevel + delta);
    }, { passive: false });

    container.addEventListener('mousedown', (e) => {
      if (this.zoomLevel <= 1.01) return;
      if (e.target.closest('#videoControls') || e.target.closest('#statsHud')) return;
      this.isPanning = true;
      this.startX = e.clientX - this.panX;
      this.startY = e.clientY - this.panY;
      container.classList.add('is-panning');
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isPanning) return;
      this.panX = e.clientX - this.startX;
      this.panY = e.clientY - this.startY;
      this.applyTransform();
    });

    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
        container.classList.remove('is-panning');
      }
    });

    if (this.dom.btnZoomIn) {
      this.dom.btnZoomIn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setZoom(this.zoomLevel + 0.25);
      });
    }

    if (this.dom.btnZoomOut) {
      this.dom.btnZoomOut.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setZoom(this.zoomLevel - 0.25);
      });
    }

    if (this.dom.btnZoomReset) {
      this.dom.btnZoomReset.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setZoom(1.0, true);
      });
    }
  }

  initAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.audioCtx = new AudioCtx({ sampleRate: 44100 });
      this.audioGainNode = this.audioCtx.createGain();
      this.audioGainNode.gain.value = this.isMuted ? 0 : 1;
      this.audioGainNode.connect(this.audioCtx.destination);
      this.nextAudioTime = 0;
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  handlePhoneAudioBinary(pcmBytes) {
    if (this.isMuted) return; // Muted locally on laptop, discard audio without playback
    this.initAudioContext();
    if (!this.audioCtx) return;

    // pcmBytes: 16-bit little-endian stereo PCM at 44.1 kHz (4 bytes per stereo pair)
    const numSamples = Math.floor(pcmBytes.length / 4);
    if (numSamples <= 0) return;

    const dataView = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
    const audioBuffer = this.audioCtx.createBuffer(2, numSamples, 44100);
    const leftChan = audioBuffer.getChannelData(0);
    const rightChan = audioBuffer.getChannelData(1);

    for (let i = 0; i < numSamples; i++) {
      const offset = i * 4;
      leftChan[i] = dataView.getInt16(offset, true) / 32768.0;
      rightChan[i] = dataView.getInt16(offset + 2, true) / 32768.0;
    }

    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioGainNode);

    const currentTime = this.audioCtx.currentTime;
    // Low-latency drift-free scheduling (20ms lookahead)
    if (this.nextAudioTime < currentTime || this.nextAudioTime > currentTime + 0.15) {
      this.nextAudioTime = currentTime + 0.02;
    }

    source.start(this.nextAudioTime);
    this.nextAudioTime += audioBuffer.duration;
  }

  toggleAudio() {
    this.isMuted = !this.isMuted;
    if (this.audioGainNode) {
      this.audioGainNode.gain.value = this.isMuted ? 0 : 1;
    }
    if (this.dom.remoteVideo) {
      this.dom.remoteVideo.muted = this.isMuted;
      if (!this.isMuted) {
        this.dom.remoteVideo.volume = 1.0;
        this.dom.remoteVideo.play().catch(() => {});
      }
    }
    this.initAudioContext();
    const svgOn = document.getElementById('svgAudioOn');
    const svgOff = document.getElementById('svgAudioOff');
    if (svgOn) svgOn.classList.toggle('hidden', this.isMuted);
    if (svgOff) svgOff.classList.toggle('hidden', !this.isMuted);
  }

  async handlePhoneScreenBinary(data) {
    let buffer = data;
    if (data instanceof Blob) {
      buffer = await data.arrayBuffer();
    }
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 2) return;

    // Check for 0x02: Audio packet (16-bit PCM 44.1 kHz Stereo)
    if (bytes[0] === 0x02) {
      this.handlePhoneAudioBinary(bytes.subarray(1));
      return;
    }

    if (this.dom.receiverWaiting) this.dom.receiverWaiting.classList.add('hidden');
    if (this.dom.remoteVideo) this.dom.remoteVideo.classList.add('hidden');
    const canvas = document.getElementById('phoneCanvas');
    if (canvas) canvas.classList.remove('hidden');

    const isKeyFrame = bytes[0] === 0x01;
    const chunkData = bytes.subarray(1);

    // Drop delta frames if we have not yet decoded our first keyframe (WebCodecs rule)
    if (!this.hasReceivedKeyFrame && !isKeyFrame) {
      return;
    }

    if (!this.h264Decoder || this.h264Decoder.state !== 'configured') {
      if (!window.VideoDecoder) {
        console.error('WebCodecs VideoDecoder not supported in this browser.');
        return;
      }

      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
      this.h264Decoder = new VideoDecoder({
        output: (frame) => {
          if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
          }
          ctx.drawImage(frame, 0, 0);
          frame.close();
        },
        error: (e) => {
          console.warn('H.264 WebCodecs error, auto-resetting decoder:', e);
          this.h264Decoder = null;
          this.hasReceivedKeyFrame = false;
        }
      });

      this.h264Decoder.configure({
        codec: 'avc1.42001f', // AVC Baseline Profile Level 3.1
        optimizeForLatency: true
      });
    }

    if (this.h264Decoder && this.h264Decoder.state === 'configured') {
      try {
        const chunk = new EncodedVideoChunk({
          type: isKeyFrame ? 'key' : 'delta',
          timestamp: performance.now() * 1000,
          data: chunkData
        });
        this.h264Decoder.decode(chunk);
        if (isKeyFrame) {
          this.hasReceivedKeyFrame = true;
          this.updateStatus('streaming', 'Phone Stream Live (60 FPS)');
        }
      } catch (e) {
        console.warn('Decode chunk error:', e);
      }
    }
  }

  stopStream() {
    this.setZoom(1.0, true);
    if (this.audioCtx) {
      try { this.audioCtx.suspend(); } catch (e) {}
    }
    this.hasReceivedKeyFrame = false;
    if (this.h264Decoder) {
      try { this.h264Decoder.close(); } catch (e) {}
      this.h264Decoder = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    this.benchmarkActive = false;
    this.isStreaming = false;
    this.pendingIceCandidates = [];
    this.dom.modeSelection.classList.remove('hidden');
    this.dom.broadcasterPanel.classList.add('hidden');
    this.dom.displayContainer.classList.add('hidden');
    if (this.dom.receiverWaiting) this.dom.receiverWaiting.classList.remove('hidden');
    this.updateStatus('disconnected', 'Ready');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.zeroCast = new ZeroCast();
});
