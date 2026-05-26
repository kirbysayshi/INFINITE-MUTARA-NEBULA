var debug = (prefix) => localStorage[prefix]
  ? (fmt, ...params) => {
    console.log(Date.now() + ' ' + prefix + ': ' + fmt, ...params);
  }
  : () => {};

var Boot = async (onProgress=()=>{}) => {

  var urlFromChunks = (chunks) => window.URL.createObjectURL(
    new Blob(chunks, { type: 'video/mp4' })
  );

  var videoFromUrl = (url) => new Promise((resolve) => {
    var v = document.createElement('video');
    v.addEventListener('loadedmetadata', () => {
      v.volume = 0;
      resolve(v);
    }, { once: true });
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.className = 'stage__video';
    v.src = url;
  });

  var sources = [
    ["clips/clip-1.mp4", 0, 0],
    ["clips/clip-2.mp4", 0, 0],
    ["clips/clip-3.mp4", 0, 0],
    ["clips/clip-4.mp4", 0, 0],
    ["clips/clip-5.mp4", 0, 0],
    ["clips/clip-6.mp4", 0, 0],
    ["clips/clip-7.mp4", 0, 0],
    ["clips/clip-8.mp4", 0, 0],
  ];

  var loaded = sources.map(() => 0);
  var totals = sources.map(() => 0);
  var report = () => {
    var total = totals.reduce((a, b) => a + b, 0);
    if (total > 0) onProgress(loaded.reduce((a, b) => a + b, 0) / total);
  };

  var loadClip = async ([url, startTime, endTime], i) => {
    var res = await fetch(url);
    if (!res.ok) throw new Error('NOT OK! ' + res.statusText);
    totals[i] = parseInt(res.headers.get('Content-Length') || '0', 10);
    report();

    var reader = res.body.getReader();
    var chunks = [];
    while (true) {
      var { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded[i] += value.length;
      report();
    }

    var video = await videoFromUrl(urlFromChunks(chunks));
    return { video, startTime, endTime: endTime || video.duration };
  };

  return Promise.all(sources.map(loadClip));
};

window.addEventListener('unhandledrejection', event => {
  console.log('unhandled', event)
  alert('unhandled ' + event.reason);
});


var dbg = debug('mutara');

class Scheduler {

  constructor (onEmpty=()=>{}) {
    this.onEmpty = onEmpty;
    this.processPoll = 100;
    this.queue = [];
    this.scheduled = null;
    this.currentTime = 0;
    this.lastTime = 0;
  }

  skip () {
    dbg('skipping current queue item');
    this.queue.shift();
  }

  queueEvent (cb, when) {
    this.queue.push({ cb, when });
    dbg('new queue length', this.queue.length, 'latest when', when)
  }

  get running() {
    return this.scheduled !== null;
  }

  start () {
    clearInterval(this.scheduled);
    this.lastTime = Date.now();
    this.scheduled = setInterval(() => this._process(), this.processPoll);
  }

  pause () {
    clearInterval(this.scheduled);
    this.scheduled = null;
  }

  _process () {

    let now = Date.now();
    let accum = now - this.lastTime;
    this.currentTime += accum;
    let forwardLimit = this.currentTime + this.processPoll;

    let i = 0;
    while (i < this.queue.length) {
      let { cb, when } = this.queue[i];
      if (when < forwardLimit) {
        this.queue.splice(i, 1);
        cb(when - this.currentTime);
        // do not increment i because we mutated the queue
      } else {
        i++
      }
    }

    if (this.queue.length === 0) {
      this.onEmpty((...args) => this.queueEvent(...args));
    }

    this.lastTime = now;
  }
}

class App {

  constructor (clips) {
    this.state = {
      clips,
      options: { random2sec: false, sequential: false, sound: false },
      scheduler: null,
      els: {},
    };
  }

  mount (root) {
    var els = this.state.els = {
      root,
      videos: root.querySelector('[data-videos]'),
      panel: root.querySelector('[data-panel]'),
      toggleBtn: root.querySelector('[data-toggle]'),
      playBtn: root.querySelector('[data-play]'),
      renderer: root.querySelector('[data-renderer]'),
    };

    this.state.clips.forEach((clip, idx, all) => {
      els.videos.appendChild(clip.video);
    });

    els.renderer.style.zIndex = '100';
    this.state.activeClip = this.state.clips[0];

    els.toggleBtn.addEventListener('click', () => this.togglePanel());
    els.playBtn.addEventListener('click', () => this.togglePlay());

    els.panel.querySelectorAll('input[data-option]').forEach(input => {
      var key = input.dataset.option;
      this.state.options[key] = input.checked;
      input.addEventListener('change', () => {
        this.state.options[key] = input.checked;
        if (key === 'random2sec') this.state.scheduler.skip();
        if (key === 'sound') this.applySound();
      });
    });

    const ctx = els.renderer.getContext('2d');
    const render = () => {
      let active = this.state.activeClip;
      if (active && this.state.scheduler.running) {
        let { videoWidth, videoHeight } = active.video;
        if (videoWidth && videoHeight) {
          if (els.renderer.width !== videoWidth) els.renderer.width = videoWidth;
          if (els.renderer.height !== videoHeight) els.renderer.height = videoHeight;
          ctx.drawImage(active.video, 0, 0, videoWidth, videoHeight);
        }
      }
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);

    const scheduler = this.state.scheduler = new Scheduler();
    let estimatedPrerollMs = 200; // track device-timing for seek+play+frame
    let swapping = false;

    const swapEvent = () => {
      if (swapping) {
        dbg('swap already in flight, skipping');
        return;
      }
      swapping = true;
      dbg('swap');
      const prepStart = performance.now();
      const curr = this.getActive();
      const next = this.chooseNext();
      const nextPlot = this.plotClipTime(next, this.state.options);

      next.video.addEventListener('seeked', () => {
        next.video.addEventListener('playing', () => {
          next.video.requestVideoFrameCallback(() => {
            this.state.activeClip = next;
            curr.video.pause();
            estimatedPrerollMs = Math.max(50, performance.now() - prepStart);
            dbg(
              'scheduling',
              'preroll', estimatedPrerollMs,
              'currentTime', scheduler.currentTime,
              'next.duration', nextPlot.durationMs
            );
            const nextTime = scheduler.currentTime + nextPlot.durationMs - estimatedPrerollMs;
            scheduler.queueEvent(swapEvent, nextTime);
            swapping = false;
          })
        }, { once: true })
        next.video.play();
      }, { once: true });

      next.video.currentTime = nextPlot.startTime;
    };

    // This actually kicks everything off, the queue is empty at start.
    scheduler.onEmpty = (queueEvent) => {
      if (swapping) return;
      dbg('onempty');
      queueEvent(swapEvent, scheduler.currentTime);
    };

    this.applySound();
    this.play();
  }

  chooseNext () {
    var { clips, options } = this.state;
    var active = this.getActive();
    var next = active;

    if (options.sequential) {
      var index = clips.indexOf(active);
      next = clips[(index + 1) % clips.length];
    } else {
      while (next === active) {
        next = clips[Math.floor(Math.random() * clips.length)];
      }
    }
    return next;
  }

  bringToFront (clip) {
    this.state.activeClip = clip;
  }

  getActive () {
    return this.state.activeClip;
  }

  plotClipTime (clip, options) {
    var { endTime, startTime } = clip;
    var plot = { startTime, endTime, duration: 0, durationMs: 0 };

    if (options.random2sec) {
      var min = 2;
      plot.startTime = (endTime - startTime - min) * Math.random();
      plot.endTime = plot.startTime + min;
    }

    plot.duration = plot.endTime - plot.startTime;
    plot.durationMs = plot.duration * 1000;
    return plot;
  }

  pause () {
    this.state.els.playBtn.textContent = '▶︎';
    this.state.scheduler.pause();
    return this.getActive().video.pause();
  }

  play () {
    this.state.els.playBtn.textContent = '⏸︎';
    this.state.scheduler.start();
    return this.getActive().video.play();
  }

  togglePlay () {
    if (this.getActive().video.paused) this.play();
    else this.pause();
  }

  applySound () {
    var { sound } = this.state.options;
    this.state.clips.forEach(({ video }) => {
      video.volume = sound ? 1 : 0;
      if (sound) video.removeAttribute('muted');
      else video.setAttribute('muted', '');
    });
  }

  togglePanel () {
    var { panel, toggleBtn } = this.state.els;
    var hidden = panel.classList.toggle('controls--hidden');
    toggleBtn.classList.toggle('toggle-btn--open', !hidden);
    toggleBtn.textContent = hidden ? '?' : 'X';
  }
}

(async function() {
  try {
    const onProgressReport = (ratio) => {
      var bar = document.querySelector('[data-loading-bar]');
      if (bar) bar.style.width = (ratio * 100).toFixed(1) + '%';
    }

    const clips = await Boot(onProgressReport);
    document.querySelector('[data-loading]').remove();
    var app = new App(clips);
    app.mount(document.querySelector('#stage'));

  } catch(err) {
    console.log('err?', err);
    alert('boot error ' + err.message)
  }
}());
