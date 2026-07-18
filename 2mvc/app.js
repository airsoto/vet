(async()=>{
  try{
    const parts=[
      "bundle0.txt",
      "bundle1.txt",
      "bundle2a.txt",
      "bundle2b.txt",
      "bundle2c.txt",
      "bundle3a.txt",
      "bundle3b1.txt",
      "bundle3b2.txt",
      "bundle3c1.txt",
      "bundle3c2.txt"
    ];

    const responses=await Promise.all(parts.map(async name=>{
      const response=await fetch(name,{cache:"no-cache"});
      if(!response.ok) throw new Error(`No se pudo cargar ${name}`);
      return (await response.text()).trim();
    }));

    const encoded=responses.join("");
    const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));
    const moduleUrl=URL.createObjectURL(new Blob([bytes],{type:"text/javascript"}));

    try{
      await import(moduleUrl);
    }finally{
      URL.revokeObjectURL(moduleUrl);
    }
  }catch(error){
    console.error("No se pudo iniciar 2MVC",error);
    const toast=document.getElementById("toast");
    if(toast){
      toast.textContent="No se pudo iniciar la aplicación";
      toast.classList.add("show");
    }
  }
})();
