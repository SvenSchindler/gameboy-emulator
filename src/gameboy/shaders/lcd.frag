precision highp float;

uniform sampler2D u_image; 
varying vec2 v_screenCoord;

uniform vec4 u_raster_color;

uniform int u_render_raster;

void main() {
    // screen coord between 0 and 1600
    // converted here to 0 - 160
    vec2 pixelIndex = floor(v_screenCoord / 10.0);
    float pixelWidth = 10.0;
    vec2 posInPixel = mod(v_screenCoord, pixelIndex * pixelWidth);
    float width = 1.2;
    if (u_render_raster > 0 && (posInPixel.x < width || posInPixel.y < width)) {
        gl_FragColor = (texture2D(u_image, vec2(pixelIndex.x / 160.0, pixelIndex.y / 144.0)) + texture2D(u_image, vec2((pixelIndex.x + 0.1) / 160.0, pixelIndex.y / 144.0)) + u_raster_color / 255.0) / 3.0;
    } else {
        gl_FragColor = texture2D(u_image, vec2(pixelIndex.x / 160.0, pixelIndex.y / 144.0));     
    }
    
    
}