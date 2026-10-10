window.siteFetch=(url,options={})=>fetch(url,{...options,signal:options.signal||AbortSignal.timeout(15e3)});
