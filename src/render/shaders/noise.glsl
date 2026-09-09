float hash31(vec3 p){ p=fract(p*vec3(0.1031,0.1030,0.0973)); p+=dot(p,p.yxz+33.33); return fract((p.x+p.y)*p.z); }
float noise3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float n000=hash31(i), n100=hash31(i+vec3(1.,0.,0.)), n010=hash31(i+vec3(0.,1.,0.)), n110=hash31(i+vec3(1.,1.,0.));
  float n001=hash31(i+vec3(0.,0.,1.)), n101=hash31(i+vec3(1.,0.,1.)), n011=hash31(i+vec3(0.,1.,1.)), n111=hash31(i+vec3(1.,1.,1.));
  return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y), mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y), f.z); }
