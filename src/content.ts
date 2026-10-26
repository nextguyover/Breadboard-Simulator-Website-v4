/** The parts and examples the app ships with, for the drawer, the marquee and the examples list. */

export interface Part {
  name: string;
  detail: string;
  img: string;
}

const p = (name: string, detail: string, img: string): Part => ({ name, detail, img });

export const PART_GROUPS: { name: string; parts: Part[] }[] = [
  {
    name: "Basics",
    parts: [
      p("Resistor", "10 Ω to 1 MΩ", "resistor"),
      p("LED", "Five colours", "led"),
      p("Electrolytic capacitor", "Mind the + leg", "capacitor_polarised"),
      p("Ceramic capacitor", "Either way round", "capacitor_non_polarised"),
      p("Inductor", "Resists change", "inductor"),
      p("Diode", "One-way valve", "diode"),
      p("Zener diode", "Holds a voltage", "diode_zener"),
    ],
  },
  {
    name: "Inputs & outputs",
    parts: [
      p("Push button", "Hold to connect", "pushbutton"),
      p("Toggle switch", "Flip between two", "toggleswitch"),
      p("Potentiometer", "Turn the knob", "potentiometer"),
      p("7-segment display", "One digit", "seven_segment"),
      p("Buzzer", "It actually beeps", "buzzer"),
      p("RGB LED", "Mix any colour", "rgb_led"),
    ],
  },
  {
    name: "Semiconductors",
    parts: [
      p("NPN transistor", "2N3904", "to92"),
      p("PNP transistor", "2N3906", "to92"),
      p("5 V regulator", "LM7805", "to220"),
      p("12 V regulator", "LM7812", "to220"),
      p("Adjustable regulator", "LM317", "to220"),
    ],
  },
  {
    name: "Chips",
    parts: [
      p("555 timer", "NE555", "dip8"),
      p("556 dual timer", "NE556", "dip14"),
      p("Op-amp", "LM741", "dip8"),
      p("Dual comparator", "LM393", "dip8"),
      p("Quad comparator", "LM339", "dip14"),
      p("NAND gates", "74HC00", "dip14"),
      p("AND gates", "74HC08", "dip14"),
      p("OR gates", "74HC32", "dip14"),
      p("XOR gates", "74HC86", "dip14"),
      p("XNOR gates", "74HC7266", "dip14"),
      p("NOR gates", "74HC02", "dip14"),
      p("NOT gates", "74HC04", "dip14"),
      p("JK flip-flops", "74LS76", "dip16"),
      p("Decade counter", "CD4026B", "dip16"),
    ],
  },
  {
    name: "Power & wiring",
    parts: [
      p("9 V battery", "Snap it on", "battery"),
      p("Jumper wire", "Ten colours", "jumper"),
      p("Breadboard", "Add as many as you like", "breadboard"),
    ],
  },
];

export const PART_COUNT = PART_GROUPS.reduce((n, g) => n + g.parts.length, 0);

export const EXAMPLES: { level: string; title: string; text: string }[] = [
  { level: "Start here", title: "Simple LED", text: "A battery, a resistor and an LED: the first circuit everyone builds." },
  { level: "Start here", title: "Overloaded LED", text: "What happens without a resistor. Run it and watch." },
  { level: "Next steps", title: "Dimmer", text: "Turn the potentiometer to change the brightness." },
  { level: "Next steps", title: "Colour mixer", text: "Three buttons light the red, green and blue parts of one RGB LED." },
  { level: "Next steps", title: "Transistor LED blinker", text: "Two transistors and two capacitors take turns, flashing two LEDs." },
  { level: "Chips", title: "555 blinking LED", text: "The classic 555 timer blinking an LED about once a second." },
  { level: "Chips", title: "AND gate", text: "A 74HC08 lights the LED only while both buttons are held." },
  { level: "Chips", title: "Counting display", text: "A 555 clocks a CD4026B counter, which shows 0 to 9 on a seven-segment display." },
];

export const LEVEL_COLOURS: Record<string, string> = {
  "Start here": "#3ddc84",
  "Next steps": "#ffb547",
  Chips: "#ff5a4a",
};
