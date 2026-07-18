(()=>{
  const OLD_PATH="../iconos/iconos/vet_calc_icons/";
  const NEW_PATH="../iconos/vet_calc_icons/";

  function fixImage(img){
    if(!(img instanceof HTMLImageElement)) return;
    const raw=img.getAttribute("src")||"";
    if(raw.includes(OLD_PATH)){
      img.setAttribute("src",raw.replace(OLD_PATH,NEW_PATH));
    }
  }

  function fixNode(node){
    if(node instanceof HTMLImageElement) fixImage(node);
    if(node?.querySelectorAll) node.querySelectorAll("img").forEach(fixImage);
  }

  new MutationObserver(mutations=>{
    for(const mutation of mutations){
      if(mutation.type==="attributes") fixImage(mutation.target);
      mutation.addedNodes.forEach(fixNode);
    }
  }).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["src"]});

  (async()=>{
    let encoded="";
    for(let i=0;i<4;i++) encoded+=await(await fetch(`code${i}.txt`)).text();
    const bytes=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0));
    const url=URL.createObjectURL(new Blob([bytes],{type:"text/javascript"}));
    try{
      await import(url);
      document.querySelectorAll("img").forEach(fixImage);
    }finally{
      URL.revokeObjectURL(url);
    }
  })();
})();