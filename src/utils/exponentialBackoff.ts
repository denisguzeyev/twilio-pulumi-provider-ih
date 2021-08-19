export const exponentialBackoff: any = async (
  obj: any,
  fn: (...args: any[]) => Promise<any>,
  parameters: any[],
  timeout: number,
  maxBackoff: number = 120000
) => {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, timeout);
  }).then(() => {
    return fn
      .call(obj, ...parameters)
      .then((result: any) => Promise.resolve(result))
      .catch((error: any) => {
        if (error.status === 429) {
          if (timeout * 2 > maxBackoff) {
            return Promise.reject(
              new Error(
                `Maximum Backoff (${maxBackoff}ms) would be reached with next execution!`
              )
            );
          }
          return exponentialBackoff(
            obj,
            fn,
            parameters,
            (timeout ? Math.trunc(timeout) * 2 : 1000) + Math.random() * 1000,
            maxBackoff
          );
        } else {
          return Promise.reject(error);
        }
      });
  });
};
