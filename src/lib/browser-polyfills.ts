/**
 * Comprehensive Browser Compatibility Polyfills & Fallbacks
 * Ensures Terrabar runs smoothly on older mobile and desktop browsers:
 * - Safari 11 - 15 (iOS 11 - 15)
 * - Chrome 60 - 95 (Android WebView, Samsung Internet 7+)
 * - Firefox 60 - 95
 * - Legacy Edge & legacy Chromium browsers
 */

export const POLYFILL_INLINE_SCRIPT = `
(function() {
  try {
    // 1. globalThis polyfill
    if (typeof globalThis === 'undefined') {
      if (typeof window !== 'undefined') {
        window.globalThis = window;
      } else if (typeof self !== 'undefined') {
        self.globalThis = self;
      }
    }

    // 2. crypto and crypto.randomUUID
    if (typeof window !== 'undefined') {
      if (!window.crypto) {
        window.crypto = {};
      }
      if (!window.crypto.getRandomValues) {
        window.crypto.getRandomValues = function(arr) {
          for (var i = 0; i < arr.length; i++) {
            arr[i] = Math.floor(Math.random() * 256);
          }
          return arr;
        };
      }
      if (!window.crypto.randomUUID) {
        window.crypto.randomUUID = function() {
          return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, function(c) {
            var n = Number(c);
            return (n ^ (window.crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (n / 4)))).toString(16);
          });
        };
      }
    }

    // 3. structuredClone fallback
    if (typeof window !== 'undefined' && typeof window.structuredClone !== 'function') {
      window.structuredClone = function(obj) {
        if (obj === undefined) return undefined;
        try {
          return JSON.parse(JSON.stringify(obj));
        } catch (e) {
          if (Array.isArray(obj)) return obj.slice();
          if (obj && typeof obj === 'object') return Object.assign({}, obj);
          return obj;
        }
      };
    }

    // 4. Promise.allSettled
    if (typeof Promise !== 'undefined' && !Promise.allSettled) {
      Promise.allSettled = function(promises) {
        return Promise.all(
          Array.from(promises).map(function(promise) {
            return Promise.resolve(promise).then(
              function(value) { return { status: 'fulfilled', value: value }; },
              function(reason) { return { status: 'rejected', reason: reason }; }
            );
          })
        );
      };
    }

    // 5. Promise.any
    if (typeof Promise !== 'undefined' && !Promise.any) {
      Promise.any = function(promises) {
        return new Promise(function(resolve, reject) {
          var arr = Array.from(promises);
          var errors = [];
          var count = 0;
          if (arr.length === 0) {
            reject(new Error('All promises were rejected'));
            return;
          }
          arr.forEach(function(promise) {
            Promise.resolve(promise).then(resolve).catch(function(err) {
              errors.push(err);
              count++;
              if (count === arr.length) {
                reject(new Error('All promises were rejected: ' + errors.join(', ')));
              }
            });
          });
        });
      };
    }

    // 6. Array.prototype.flat & flatMap
    if (!Array.prototype.flat) {
      Array.prototype.flat = function(depth) {
        var d = typeof depth === 'number' ? depth : 1;
        function flatten(arr, cur) {
          return arr.reduce(function(acc, val) {
            return acc.concat(Array.isArray(val) && cur < d ? flatten(val, cur + 1) : val);
          }, []);
        }
        return flatten(this, 0);
      };
    }
    if (!Array.prototype.flatMap) {
      Array.prototype.flatMap = function(fn, thisArg) {
        return this.map(fn, thisArg).flat();
      };
    }

    // 7. Array.prototype.at & String.prototype.at
    if (!Array.prototype.at) {
      Array.prototype.at = function(index) {
        var idx = Math.trunc(index) || 0;
        if (idx < 0) idx += this.length;
        if (idx < 0 || idx >= this.length) return undefined;
        return this[idx];
      };
    }
    if (!String.prototype.at) {
      String.prototype.at = function(index) {
        var idx = Math.trunc(index) || 0;
        if (idx < 0) idx += this.length;
        if (idx < 0 || idx >= this.length) return '';
        return this.charAt(idx);
      };
    }

    // 8. Object.fromEntries & Object.hasOwn
    if (!Object.fromEntries) {
      Object.fromEntries = function(entries) {
        if (!entries || !entries[Symbol.iterator]) return {};
        var obj = {};
        var iterator = entries[Symbol.iterator]();
        var step;
        while (!(step = iterator.next()).done) {
          var pair = step.value;
          if (Object(pair) === pair && pair.length >= 2) {
            obj[pair[0]] = pair[1];
          }
        }
        return obj;
      };
    }
    if (!Object.hasOwn) {
      Object.hasOwn = function(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
      };
    }

    // 9. String.prototype.replaceAll
    if (!String.prototype.replaceAll) {
      String.prototype.replaceAll = function(search, replacement) {
        if (search instanceof RegExp) {
          if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp');
          return this.replace(search, replacement);
        }
        return this.split(search).join(replacement);
      };
    }

    // 10. queueMicrotask
    if (typeof window !== 'undefined' && typeof window.queueMicrotask !== 'function') {
      window.queueMicrotask = function(cb) {
        Promise.resolve().then(cb).catch(function(err) {
          setTimeout(function() { throw err; }, 0);
        });
      };
    }

    // 11. requestIdleCallback / cancelIdleCallback (iOS Safari fallback)
    if (typeof window !== 'undefined') {
      if (!window.requestIdleCallback) {
        window.requestIdleCallback = function(cb) {
          var start = Date.now();
          return setTimeout(function() {
            cb({
              didTimeout: false,
              timeRemaining: function() {
                return Math.max(0, 50 - (Date.now() - start));
              }
            });
          }, 1);
        };
      }
      if (!window.cancelIdleCallback) {
        window.cancelIdleCallback = function(id) {
          clearTimeout(id);
        };
      }
    }

    // 12. ResizeObserver safe fallback
    if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
      window.ResizeObserver = function() {
        this.observe = function() {};
        this.unobserve = function() {};
        this.disconnect = function() {};
      };
    }

    // 13. IntersectionObserver safe fallback (marks elements visible immediately)
    if (typeof window !== 'undefined' && typeof window.IntersectionObserver === 'undefined') {
      window.IntersectionObserver = function(callback) {
        this.observe = function(element) {
          try {
            callback([{
              isIntersecting: true,
              target: element,
              intersectionRatio: 1,
              boundingClientRect: element.getBoundingClientRect ? element.getBoundingClientRect() : {},
              intersectionRect: element.getBoundingClientRect ? element.getBoundingClientRect() : {},
              rootBounds: null,
              time: Date.now()
            }], this);
          } catch(e) {}
        };
        this.unobserve = function() {};
        this.disconnect = function() {};
      };
    }

    // 14. Element.prototype.replaceChildren
    if (typeof Element !== 'undefined' && !Element.prototype.replaceChildren) {
      Element.prototype.replaceChildren = function() {
        while (this.firstChild) {
          this.removeChild(this.firstChild);
        }
        this.append.apply(this, arguments);
      };
    }

    // 15. NodeList.prototype.forEach
    if (typeof NodeList !== 'undefined' && !NodeList.prototype.forEach) {
      NodeList.prototype.forEach = Array.prototype.forEach;
    }

    // 16. navigator.clipboard fallback for older browsers / non-HTTPS
    if (typeof navigator !== 'undefined') {
      if (!navigator.clipboard) {
        navigator.clipboard = {
          writeText: function(text) {
            return new Promise(function(resolve, reject) {
              try {
                var textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                textArea.style.top = '-9999px';
                textArea.style.opacity = '0';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                var successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                if (successful) resolve();
                else reject(new Error('Copy failed'));
              } catch (err) {
                reject(err);
              }
            });
          }
        };
      }
    }

    // 17. Feature flag tags on documentElement for CSS resilience
    if (typeof document !== 'undefined' && document.documentElement) {
      var docEl = document.documentElement;
      
      // Check OKLCH support
      var supportsOklch = false;
      if (typeof CSS !== 'undefined' && CSS.supports) {
        supportsOklch = CSS.supports('color', 'oklch(0 0 0)');
      }
      if (!supportsOklch) {
        docEl.classList.add('no-oklch');
      }

      // Check WebP support
      var testCanvas = document.createElement('canvas');
      if (testCanvas.getContext && testCanvas.getContext('2d')) {
        var isWebPSupported = testCanvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
        if (!isWebPSupported) {
          docEl.classList.add('no-webp');
        }
      }
    }
  } catch(e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('Browser polyfills initialization notice:', e);
    }
  }
})();
`;

export function initBrowserPolyfills(): void {
  if (typeof window === "undefined") return;
  // Evaluate polyfills if loaded as module
  try {
    const fn = new Function(POLYFILL_INLINE_SCRIPT);
    fn();
  } catch {
    // Already inlined or eval disabled
  }
}
