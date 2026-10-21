/*
 * A CACHED COPY THAT CANNOT START IS MENDED, AND REPLACED AT ONCE.
 *
 * Loaded into the service worker by `workbox.importScripts` (vite.config.ts).
 *
 * A deploy once put the app's main script on the server as an EMPTY file for a
 * few minutes. Every device that installed the worker in those minutes stored
 * that empty file, and kept serving it after the server was fixed: the file
 * name is its content hash, so to the worker nothing had changed. Those
 * devices showed a white page on every load, and worked only on a hard reload
 * — the one load that skips the worker.
 *
 * So when a new worker installs, it looks through the stored copies for an
 * empty script or stylesheet. Each one is fetched again; a real file from the
 * server takes its place, and one the server no longer has is dropped.
 *
 * A new worker normally WAITS until the shop chooses to update (registerType
 * "prompt" — never mid-shift). A copy that held an empty file cannot ask: its
 * page never starts. So this worker then takes over straight away and reloads
 * the windows that were stuck.
 */
(function () {
  var healing = false;

  function isEmpty(response) {
    var length = response.headers.get("content-length");
    if (length !== null) return Promise.resolve(Number(length) === 0);
    return response
      .clone()
      .blob()
      .then(function (body) {
        return body.size === 0;
      });
  }

  /** The server's own copy, or null. A missing file comes back as the app's page, not a 404. */
  function freshCopy(url) {
    var kind = /\.css(\?|$)/.test(url) ? "css" : "javascript";
    return fetch(url, { cache: "no-store", credentials: "same-origin" })
      .then(function (response) {
        if (!response.ok || (response.headers.get("content-type") || "").indexOf(kind) === -1) return null;
        return isEmpty(response).then(function (empty) {
          return empty ? null : response;
        });
      })
      .catch(function () {
        return null;
      });
  }

  /** True when this cache held an empty file; each one is replaced or dropped. */
  function mend(cache) {
    return cache.keys().then(function (requests) {
      var files = requests.filter(function (r) {
        return /\.(js|css)(\?|$)/.test(r.url);
      });
      return Promise.all(
        files.map(function (request) {
          return cache.match(request).then(function (stored) {
            if (!stored) return false;
            return isEmpty(stored).then(function (empty) {
              if (!empty) return false;
              return freshCopy(request.url)
                .then(function (fresh) {
                  return fresh ? cache.put(request, fresh) : cache.delete(request);
                })
                .then(function () {
                  return true;
                });
            });
          });
        }),
      ).then(function (mended) {
        return mended.indexOf(true) !== -1;
      });
    });
  }

  function mendCopies() {
    return self.caches.keys().then(function (names) {
      var copies = names.filter(function (name) {
        return name.indexOf("-precache-") !== -1;
      });
      return Promise.all(
        copies.map(function (name) {
          return self.caches.open(name).then(mend);
        }),
      ).then(function (mended) {
        return mended.indexOf(true) !== -1;
      });
    });
  }

  self.addEventListener("install", function (event) {
    event.waitUntil(
      mendCopies()
        .then(function (broken) {
          if (!broken) return;
          healing = true;
          return self.skipWaiting();
        })
        .catch(function () {}),
    );
  });

  self.addEventListener("activate", function (event) {
    if (!healing) return;
    // The reloads are not awaited: a reload asks this worker for the page, and
    // it answers only once activation is over — so waiting would never end.
    event.waitUntil(
      self.clients.matchAll({ type: "window" }).then(function (windows) {
        windows.forEach(function (w) {
          w.navigate(w.url).catch(function () {});
        });
      }),
    );
  });
})();
