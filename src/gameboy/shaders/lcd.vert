precision highp float;

attribute vec2 a_position;
 
varying vec2 v_screenCoord;

void main() {
   vec2 scaled = a_position * 2.0 - 1.0;
   gl_Position = vec4(scaled.x, -scaled.y, 1.0, 1.0);
   // We'll provide coordinates on teh screen between 0x0 and 1600x1440
   v_screenCoord = vec2(a_position.x * 1600.0, a_position.y * 1440.0);
}