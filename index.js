var debug = (prefix) => localStorage[prefix]
  ? (fmt, ...params) => {
    console.log(Date.now() + ' ' + prefix + ': ' + fmt, ...params);
  }
  : () => {};

var applyStyle = (el, props) => {
  Object.keys(props).forEach(name => {
    el.style[name] = props[name];
  });
  return el;
}

var o_o = (name, props={}, children=[]) => {
  var el = document.createElement(name);
  var ref;
  Object.keys(props).forEach(name => {
    // Ref callbacks to ease... getting a ref
    if (name == 'ref' && typeof props[name] === 'function') {
      ref = props[name];
    }
    if (name === 'style') {
      applyStyle(el, props[name]);
    } else {
      // Attributes
      if (
        name === 'for'
        || name === 'type'
        || name === 'selected'
        || name === 'checked'
      ) {
        if (props[name]) {
          el.setAttribute(name, props[name]);
        } else {
          // Attributes must be removed, not just set to false.
          el.removeAttribute(name);
        }
      } else {
        // An actual prop.
        el[name] = props[name];
      }
    }
  });
  children.forEach(child => {
    if (child instanceof Element) el.appendChild(child);
    else {
      var t = document.createElement('text');
      t.textContent = child;
      el.appendChild(t);
    }
  })
  // Only call the ref callback once the children are there.
  if (ref) ref(el);
  return el;
}

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
    v.setAttribute('playsinline', '');
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

function CheckboxEl (label, onchange, onRef=()=>{}) {
  return o_o('label', {
    style: { display: 'block', }
  }, [
    o_o('input', {
      type: 'checkbox',
      onchange,
      ref: onRef,
      style: {
        verticalAlign: 'middle',
      }
    }),
    o_o('span', {
      style: {
        verticalAlign: 'middle',
      }
    }, [label]),
  ])
}

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
  }

  start () {
    clearInterval(this.scheduled);
    this.currentTime = 0;
    this.lastTime = Date.now();
    this.scheduled = setInterval(() => this._process(), this.processPoll);
  }

  pause () {
    clearInterval(this.scheduled);
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
        this.queue.shift();
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
      controls: {},
      controlsFade: null,
      controlsFadeDelay: 1000,
      root: null,
      options: {
        random2sec: false,
        sequential: false,
        sound: false,
      },
      scheduler: null,
    }
  }

  isPortrait () {
    return window.innerHeight > window.innerWidth;
  }

  applyLayout () {
    var { clips, controls } = this.state;
    var portrait = this.isPortrait();

    clips.forEach((clip) => {
      if (portrait) {
        applyStyle(clip.video, {
          minHeight: '',
          minWidth: '',
          width: '100%',
          height: 'auto',
          maxHeight: '100%',
        });
      } else {
        applyStyle(clip.video, {
          minHeight: '100%',
          minWidth: '100%',
          width: '',
          height: '',
          maxHeight: '',
        });
      }
    });

    if (portrait) this.state.controlsFadeDelay = 5000;
    else this.state.controlsFadeDelay = 1000;

    if (controls.panel) {
      var scale = portrait
        ? Math.max(1, Math.min(window.innerWidth, window.innerHeight) / 320)
        : 1;
      controls.panel.style.transform = 'scale(' + scale + ')';
      controls.panel.style.transformOrigin = 'top left';
    }
  }

  mount (root) {
    this.state.root = root;

    var progress = root.querySelector('.loading-progress');
    if (progress) progress.remove();

    var font = '9px/12px Arial, sans-serif';

    applyStyle(this.state.root, {
      position: 'relative',
      height: '100vh',
      overflow: 'hidden',
    });

    var clipsDiv = o_o('div', {
      style: {
        position: 'absolute',
        left: '0px',
        top: '0px',
        width: '100%',
        height: '100%',
      },
    }, [
      ...this.state.clips.map((clip, idx, clips) => {
        return applyStyle(clip.video, {
          position: 'absolute',
          top: '-999999px',
          right: '-999999px',
          bottom: '-999999px',
          left: '-999999px',
          margin: 'auto',
          zIndex: clips.length - idx,
        })
      })
    ]);

    this.state.root.appendChild(clipsDiv);

    var controlsDiv = o_o('div', {
      className: 'controls',
      ref: (el) => { this.state.controls.panel = el; },
      style: {
        position: 'absolute',
        left: '20px',
        top: '20px',
        padding: '10px',
        transition: 'opacity 1s ease-out 0s',
        zIndex: this.state.clips.length + 1,
        backgroundColor: '#333333',
        color: 'white',
        font,
      }
    }, [
      o_o('div', {
        className: 'btn-wrap',
        style: {
          position: 'relative',
          width: '50px',
          height: '50px',
          margin: 'auto',
        }
      }, [
        o_o('button', {
          className: 'play-btn',
          ref: el => { this.state.controls.playBtn = el },
          onclick: () => this.togglePlay(),
          style: {
            font,
            textAlign: 'center',
            color: '#333333',
            padding: '0',
            margin: '0',
            width: '100%',
            height: '100%',
            border: '2px solid #333333',
            borderRadius: '100% 100% 100% 100%',
          }
        }),
      ]),

      o_o('div', {
        style: {
          paddingTop: '10px',
        }
      }, [
        CheckboxEl('SEQUENTIAL', ({ target: { checked } }) => {
          this.state.options.sequential = !!checked;
        }),
        CheckboxEl('RANDOM 2 SECONDS', ({ target: { checked } }) => {
          this.state.options.random2sec = !!checked;
          this.state.scheduler.skip();
        }, (el) => {
          this.state.options.random2sec = true;
          el.setAttribute('checked', 'checked');
        }),
        CheckboxEl('SOUND', ({ target: { checked } }) => {
          this.state.options.sound = !!checked;
          this.toggleSound();
        }),
      ]),

    ]);

    this.state.root.onmousemove = () => this.showControls();
    this.state.root.onclick = () => this.showControls();

    this.state.root.appendChild(controlsDiv);

    this.state.scheduler = new Scheduler();
    const { scheduler } = this.state;

    let curr = this.getActive();
    let plot = this.plotClipTime(curr, this.state.options);
    dbg('seeking curr')
    curr.video.currentTime = plot.startTime;
    this.bringToFront(curr);
    const seekTime = 1000;

    const nextEvent = (amtEarly) => {
      dbg('choosing next');
      let next = this.chooseNext();
      let nextPlot = this.plotClipTime(next, this.state.options);
      next.video.currentTime = nextPlot.startTime;

      scheduler.queueEvent((amtEarly) => {
        dbg('playing next');
        let curr = this.getActive();

        next.video.onplay = () => {
          dbg('onplay');
        }

        next.video.onplaying = () => {
          dbg('onplaying');
          this.bringToFront(next);
          curr.video.pause();
        }
        next.video.play();

        let nextSeekTime = scheduler.currentTime + (plot.durationMs - seekTime);
        scheduler.queueEvent(nextEvent, nextSeekTime);
      }, scheduler.currentTime + seekTime + amtEarly);
    }

    this.state.scheduler.queueEvent(nextEvent, plot.durationMs - seekTime);

    this.applyLayout();
    window.addEventListener('resize', () => this.applyLayout());
    window.addEventListener('orientationchange', () => this.applyLayout());

    this.toggleSound();
    this.showControls();
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
    var { clips } = this.state;
    clips.forEach((clip, i) => applyStyle(clip.video, {
      zIndex: i
    }));
    applyStyle(clip.video, { zIndex: clips.length });
  }

  getActive () {
    var { clips } = this.state;
    return clips.slice().sort((a, b) =>
      parseInt(b.video.style.zIndex, 10) - parseInt(a.video.style.zIndex, 10)
    )[0];
  }

  plotClipTime (clip, options) {
    var {
      endTime,
      startTime,
      video: { currentTime, duration }
    } = clip;

    var plot = {
      startTime: startTime,
      endTime: endTime,
      duration: 0,
      durationMs: 0,
    };

    if (options.random2sec) {
      var min = 2;
      plot.startTime = (endTime - startTime - min) * Math.random();
      plot.endTime = plot.startTime + min;
    }

    plot.duration = plot.endTime - plot.startTime;
    plot.durationMs = plot.duration * 1000;

    //dbg('plot %o for clip %o', plot, clip);
    return plot;
  }

  pause () {
    this.state.controls.playBtn.innerHTML = '&#9654;';
    this.state.scheduler.pause();
    return this.getActive().video.pause();
  }

  play () {
    this.state.controls.playBtn.innerHTML = '&#9646;&#9646;';
    this.state.scheduler.start();
    return this.getActive().video.play();
  }

  isPaused () {
    var { video } = this.getActive();
    if (video.paused) { return true }
    else { return false }
  }

  togglePlay () {
    if (this.isPaused()) {
      this.play();
    } else {
      this.pause();
    }
  }

  toggleSound () {
    var { sound } = this.state.options;
    var { clips } = this.state;
    clips.forEach(({ video }) => {
      video.volume = sound ? 1 : 0;
    });
  }

  showControls () {
    var { panel } = this.state.controls;
    if (this.state.controlsFade) clearTimeout(this.state.controlsFade);
    panel.style.opacity = '1';
    this.state.controlsFade = setTimeout(() => {
      var { panel } = this.state.controls;
      panel.style.opacity = '0';
      this.state.controlsFade = null;
    }, this.state.controlsFadeDelay);
  }
}

var bar = document.querySelector('#stage .loading-progress > .bar');
Boot((ratio) => {
  if (bar) bar.style.width = (ratio * 100).toFixed(1) + '%';
}).then(clips => {
  var app = new App(clips);
  app.mount(document.querySelector('#stage'));
}).catch(err => {
  console.log('err?', err);
  alert('boot error ' + err.message)
});

