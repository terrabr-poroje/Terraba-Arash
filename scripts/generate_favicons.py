import math
import zlib
import struct
import os
import subprocess

def make_png(width, height, rgba_data):
    """Encodes raw RGBA byte buffer into valid PNG bytes using standard library."""
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    raw = bytearray()
    row_bytes = width * 4
    for y in range(height):
        raw.append(0)  # filter type 0 (None)
        raw.extend(rgba_data[y * row_bytes : (y + 1) * row_bytes])
    idat = zlib.compress(bytes(raw), 9)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

def render_sprout(size=64):
    """Renders the Terrabar Sprout icon inside a rounded emerald square with 3x antialiasing."""
    SS = 3
    W = size * SS
    H = size * SS
    
    # Target scale from 24x24 Lucide icon:
    pad = 10.0 * (size / 64.0)
    icon_box = 44.0 * (size / 64.0)
    s = (icon_box / 24.0) * SS
    ox = pad * SS
    oy = pad * SS
    
    # Corner radius for rounded rect
    rx = 16.0 * (size / 64.0) * SS
    
    # Stroke thickness: 2.2 units in 24x24
    stroke_r = (2.2 * s) / 2.0
    
    # Precompute stroke centerline points:
    def eval_cubic(p0, p1, p2, p3, t):
        omt = 1 - t
        return (omt**3 * p0[0] + 3*omt**2*t * p1[0] + 3*omt*t**2 * p2[0] + t**3 * p3[0],
                omt**3 * p0[1] + 3*omt**2*t * p1[1] + 3*omt*t**2 * p2[1] + t**3 * p3[1])

    stroke_points = []
    
    # 1. Base line: M 5 21 h 14
    for i in range(160):
        t = i / 159.0
        stroke_points.append((ox + (5 + 14 * t) * s, oy + 21 * s))

    # 2. Left leaf: M 4 9, top curve and bottom curve
    for i in range(200):
        t = i / 199.0
        p = eval_cubic((4, 9), (5.5, 7.0), (9.5, 9.0), (12, 13), t)
        stroke_points.append((ox + p[0] * s, oy + p[1] * s))
        p2 = eval_cubic((12, 13), (9.5, 14.5), (5.5, 12.0), (4, 9), t)
        stroke_points.append((ox + p2[0] * s, oy + p2[1] * s))

    # 3. Main stem and right leaf:
    # M14 9.536V7
    for i in range(30):
        t = i / 29.0
        stroke_points.append((ox + 14 * s, oy + (9.536 + (7 - 9.536) * t) * s))
    # a4 4 0 0 1 4 -4 -> to 18, 3
    for i in range(50):
        t = i / 49.0
        p = eval_cubic((14, 7), (14, 4.8), (15.8, 3), (18, 3), t)
        stroke_points.append((ox + p[0] * s, oy + p[1] * s))
    # h1.5 -> to 19.5, 3
    for i in range(15):
        t = i / 14.0
        stroke_points.append((ox + (18 + 1.5 * t) * s, oy + 3 * s))
    # a.5 .5 0 0 1 .5 .5 -> to 20, 3.5
    for i in range(10):
        t = i / 9.0
        p = eval_cubic((19.5, 3), (19.8, 3), (20, 3.2), (20, 3.5), t)
        stroke_points.append((ox + p[0] * s, oy + p[1] * s))
    # V5 -> to 20, 5
    for i in range(20):
        t = i / 19.0
        stroke_points.append((ox + 20 * s, oy + (3.5 + 1.5 * t) * s))
    # a4 4 0 0 1 -4 4 -> to 16, 9
    for i in range(50):
        t = i / 49.0
        p = eval_cubic((20, 5), (20, 7.2), (18.2, 9), (16, 9), t)
        stroke_points.append((ox + p[0] * s, oy + p[1] * s))
    # a4 4 0 0 0 -4 4 -> to 12, 13
    for i in range(50):
        t = i / 49.0
        p = eval_cubic((16, 9), (13.8, 9), (12, 10.8), (12, 13), t)
        stroke_points.append((ox + p[0] * s, oy + p[1] * s))
    # c0 2 1 3 1 5 -> (12, 13) to (13, 18)
    for i in range(60):
        t = i / 59.0
        p = eval_cubic((12, 13), (12, 15), (13, 16), (13, 18), t)
        stroke_points.append((ox + p[0] * s, oy + p[1] * s))
    # a5 5 0 0 1 -1 3 -> to (12, 21)
    for i in range(40):
        t = i / 39.0
        p = eval_cubic((13, 18), (13, 19.5), (12.5, 20.5), (12, 21), t)
        stroke_points.append((ox + p[0] * s, oy + p[1] * s))

    # Grid acceleration for stroke points:
    cell_size = max(1, int(stroke_r + 2))
    grid = {}
    for px, py in stroke_points:
        gx = int(px // cell_size)
        gy = int(py // cell_size)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                key = (gx + dx, gy + dy)
                if key not in grid:
                    grid[key] = []
                grid[key].append((px, py))

    # Downsampled output buffer
    final_pixels = bytearray(size * size * 4)
    
    # Colors:
    # Gradient: top-left (35, 136, 91) to bottom-right (24, 92, 62)
    # White stroke: (255, 255, 255)
    
    for y in range(size):
        for x in range(size):
            r_accum = 0.0
            g_accum = 0.0
            b_accum = 0.0
            a_accum = 0.0
            
            for sy in range(SS):
                for sx in range(SS):
                    sub_x = x * SS + sx + 0.5
                    sub_y = y * SS + sy + 0.5
                    
                    # Rounded box distance
                    dx = max(0.0, abs(sub_x - W/2) - (W/2 - rx))
                    dy = max(0.0, abs(sub_y - H/2) - (H/2 - rx))
                    dist_to_corner = math.sqrt(dx*dx + dy*dy)
                    
                    if dist_to_corner > rx:
                        continue  # outside rounded box
                    
                    # Gradient background:
                    t_diag = (sub_x + sub_y) / (W + H)
                    bg_r = int(35 + (24 - 35) * t_diag)
                    bg_g = int(136 + (92 - 136) * t_diag)
                    bg_b = int(91 + (62 - 91) * t_diag)
                    
                    # Check stroke distance
                    gx = int(sub_x // cell_size)
                    gy = int(sub_y // cell_size)
                    nearby = grid.get((gx, gy), [])
                    min_sq_dist = 999999.0
                    for px, py in nearby:
                        d2 = (sub_x - px)**2 + (sub_y - py)**2
                        if d2 < min_sq_dist:
                            min_sq_dist = d2
                            if min_sq_dist < 1.0:
                                break
                    
                    min_dist = math.sqrt(min_sq_dist)
                    if min_dist <= stroke_r:
                        # Inside white sprout stroke
                        r_accum += 255
                        g_accum += 255
                        b_accum += 255
                        a_accum += 255
                    elif min_dist < stroke_r + 1.2:
                        # Antialiased stroke edge
                        alpha_stroke = 1.0 - (min_dist - stroke_r) / 1.2
                        r_accum += 255 * alpha_stroke + bg_r * (1.0 - alpha_stroke)
                        g_accum += 255 * alpha_stroke + bg_g * (1.0 - alpha_stroke)
                        b_accum += 255 * alpha_stroke + bg_b * (1.0 - alpha_stroke)
                        a_accum += 255
                    else:
                        r_accum += bg_r
                        g_accum += bg_g
                        b_accum += bg_b
                        a_accum += 255
            
            samples = SS * SS
            idx = (y * size + x) * 4
            final_pixels[idx] = int(round(r_accum / samples))
            final_pixels[idx + 1] = int(round(g_accum / samples))
            final_pixels[idx + 2] = int(round(b_accum / samples))
            final_pixels[idx + 3] = int(round(a_accum / samples))
            
    return make_png(size, size, final_pixels)

os.makedirs('public', exist_ok=True)

print("Rendering 64x64 PNG...")
png64 = render_sprout(64)
with open('public/favicon-64.png', 'wb') as f:
    f.write(png64)

print("Rendering 32x32 PNG...")
png32 = render_sprout(32)
with open('public/favicon-32.png', 'wb') as f:
    f.write(png32)

print("Rendering 180x180 Apple Touch Icon...")
png180 = render_sprout(180)
with open('public/apple-touch-icon.png', 'wb') as f:
    f.write(png180)

# Build multi-resolution favicon.ico with ImageMagick convert
cmd = [
    "convert",
    "public/favicon-64.png",
    "public/favicon-32.png",
    "-define", "icon:auto-resize=64,32,16",
    "public/favicon.ico"
]
subprocess.run(cmd, check=True)
print("favicon.ico generated successfully!")
