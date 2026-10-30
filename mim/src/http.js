// Promise wrapper over the mimOE HTTP client (callbacks only; result.data is always a string).
function requestAction(opt) {
  return new Promise((resolve, reject) => {
    global.context.http.request({
      url: opt.url,
      type: opt.method || 'GET',
      headers: opt.headers,
      authorization: opt.authorization,
      data: opt.jsonBody && JSON.stringify(opt.jsonBody),
      socketTimeout: opt.socketTimeout,
      success: (result) => resolve(result),
      error: (err) => {
        if (err instanceof Error) {
          reject(err);
        } else {
          reject(new Error(err.content || err.message));
        }
      },
    });
  });
}

module.exports = { requestAction };
