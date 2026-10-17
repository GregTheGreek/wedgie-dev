# Draws one /assemble step from a photo (OpenAI images/edits, gpt-image-2.5-sunburst), same style as every
# other drawing. Key: OPENAI_API_KEY in ~/clawd/clawd-web-chat/.env. Then trim + pack it like tools/asmimg.py.
#   python3 tools/asmdraw.py <photo.jpg> <out.png> "<what's in the photo>"
import os,sys,base64,json,urllib.request,uuid
key=[l.split('=',1)[1].strip().strip('"') for l in open(os.path.expanduser('~/clawd/clawd-web-chat/.env')) if l.startswith('OPENAI_API_KEY=')][0]
PROMPT="""Task: redraw the input photo as one illustration for a printed hardware assembly manual.

Change only the medium: from photo to clean flat vector illustration.
Style: crisp uniform dark-charcoal outlines, flat fills with one soft shade per surface, gentle drop shadow under objects, plain warm off-white background (#faf8f4). Calm, precise, like a premium product manual. Every illustration in this series uses this same style.

Preserve exactly: camera angle, framing, perspective, every part and its shape, size, color and position. Same wire colors in the same order. Same number of pins, sockets, buttons and holes. Same orientation of every board and connector.
Remove: the cutting mat, grid lines, paper printouts, foam, cables and clutter that are not the subject.
Do not add: text, labels, numbers, logos, arrows, hands or any new objects.
Subject: {subject}"""
def gen(src,out,subject,model='gpt-image-2.5-sunburst',size='1024x1536',q='high'):
    b='----'+uuid.uuid4().hex; parts=[]
    def f(n,v): parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{n}"\r\n\r\n{v}\r\n'.encode())
    f('model',model); f('prompt',PROMPT.format(subject=subject)); f('size',size); f('quality',q)
    parts.append(f'--{b}\r\nContent-Disposition: form-data; name="image"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode()+open(src,'rb').read()+b'\r\n')
    parts.append(f'--{b}--\r\n'.encode())
    req=urllib.request.Request('https://api.openai.com/v1/images/edits',data=b''.join(parts),headers={'Authorization':'Bearer '+key,'Content-Type':'multipart/form-data; boundary='+b})
    try: r=json.load(urllib.request.urlopen(req,timeout=600))
    except urllib.error.HTTPError as e: print(src,e.read()[:500]); return
    open(out,'wb').write(base64.b64decode(r['data'][0]['b64_json'])); print('ok',out)
if __name__=='__main__': gen(*sys.argv[1:4])
