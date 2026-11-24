import struct,sys
from PIL import Image
d=open(sys.argv[1],'rb').read()
sec=int(sys.argv[2]); W=int(sys.argv[3]); skip=int(sys.argv[4]); out=sys.argv[5]
o=sec*2048
pal=[]
for i in range(256):
    v=struct.unpack_from('<H',d,o+0x14+i*2)[0]
    r=(v>>11)&31; g=(v>>5)&63; b=v&31
    pal.append(((r*255)//31,(g*255)//63,(b*255)//31))
px=d[o+skip:o+skip+W*480]
H=len(px)//W
im=Image.new('P',(W,H)); im.putpalette([c for p in pal for c in p]); im.frombytes(px) if False else im.putdata(list(px[:W*H]))
im.convert('RGB').save(out); print(W,H)
