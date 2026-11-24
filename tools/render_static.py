"""Contact sheet of a static mesh pack: render_static.py <pack sector> <texture sector> <out.png>  (software rasteriser)."""
import json,sys,struct
import os
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
sys.path.insert(0,HERE)
import meshparse, numpy as np
from PIL import Image
d=open(os.path.join(ROOT,'original','BLAZE.ALL'),'rb').read(); S=2048
P={p['sector']:p for p in json.load(open(os.path.join(ROOT,'data','packs.json')))}
def tex(sec):
    o=sec*S; psize=struct.unpack_from('<I',d,o+8)[0]; Pp=o+psize+8
    A,B=struct.unpack_from('<HH',d,Pp+8); W,H=2*A,B
    pix=d[Pp+12:Pp+12+W*H]; pal=[struct.unpack_from('<H',d,o+0x14+2*i)[0] for i in range(256)]
    a=np.zeros((H,W,4),np.uint8)
    for y in range(H):
        for x in range(W):
            v=pal[pix[y*W+x]] if y*W+x<len(pix) else 0
            a[y,x]=(0,0,0,0) if v==0 else ((v&31)*255//31,((v>>5)&31)*255//31,((v>>10)&31)*255//31,255)
    return a
def render_part(r,T,SZ=160,rx=0.5,ry=0.6):
    import math
    V=np.array(r['verts'],float)
    if len(V)==0: return np.zeros((SZ,SZ,3),np.uint8)
    cy,sy=math.cos(ry),math.sin(ry); cx,sx=math.cos(rx),math.sin(rx)
    Ry=np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]]); Rx=np.array([[1,0,0],[0,cx,-sx],[0,sx,cx]])
    W=V@Ry.T@Rx.T
    mn=W.min(0); mx=W.max(0); sc=SZ*0.85/max(1,(mx-mn)[:2].max()); c=(mn+mx)/2
    X=SZ/2+(W[:,0]-c[0])*sc; Y=SZ/2+(W[:,1]-c[1])*sc; Z=W[:,2]
    img=np.full((SZ,SZ,3),(24,24,32),np.uint8); zb=np.full((SZ,SZ),-1e9); TH,TW=T.shape[:2]
    for f in r['faces']+r['extra']:
        idx=f['v']
        if any(j>=len(V) for j in idx): continue
        slots=[]
        for k in range(4):
            if not any(idx[q]==idx[k] for q in slots): slots.append(k)
        for t in ([[0,1,2],[0,2,3]] if len(slots)==4 else ([slots] if len(slots)==3 else [])):
            ids=[idx[k] for k in t]; uvs=[f['uv'][k] for k in t]
            (ax,ay),(bx,by),(cx_,cy_)=[(X[i],Y[i]) for i in ids]
            den=(by-cy_)*(ax-cx_)+(cx_-bx)*(ay-cy_)
            if abs(den)<1e-6: continue
            for y in range(max(int(min(ay,by,cy_)),0),min(int(max(ay,by,cy_)),SZ-1)+1):
                for x in range(max(int(min(ax,bx,cx_)),0),min(int(max(ax,bx,cx_)),SZ-1)+1):
                    l1=((by-cy_)*(x-cx_)+(cx_-bx)*(y-cy_))/den; l2=((cy_-ay)*(x-cx_)+(ax-cx_)*(y-cy_))/den; l3=1-l1-l2
                    if l1<0 or l2<0 or l3<0: continue
                    z=l1*Z[ids[0]]+l2*Z[ids[1]]+l3*Z[ids[2]]
                    if z>zb[y,x]:
                        u=l1*uvs[0][0]+l2*uvs[1][0]+l3*uvs[2][0]; v=l1*uvs[0][1]+l2*uvs[1][1]+l3*uvs[2][1]
                        px=T[min(int(v),TH-1),min(int(u),TW-1)]
                        if px[3]>0: img[y,x]=px[:3]; zb[y,x]=z
    return img
def sheet(sec,texsec,out,cols=7):
    p=P[sec]; base=sec*S+4+4*p['n']; offs=[b['off'] for b in p['blobs']]
    nxt=min(q for q in P if q>sec); ends=offs[1:]+[nxt*S-base]
    pp=meshparse.parse_pack(d,base,offs,ends); T=tex(texsec)
    ims=[render_part(pp[i],T) for i in range(p['n']) if i in pp]
    rows=(len(ims)+cols-1)//cols; sh=Image.new('RGB',(cols*160,rows*160))
    for k,im in enumerate(ims): sh.paste(Image.fromarray(im),((k%cols)*160,(k//cols)*160))
    sh.save(out); print(out,len(ims),'parts', sorted(pp)[:30])
if __name__=='__main__': sheet(int(sys.argv[1]),int(sys.argv[2]),sys.argv[3])
