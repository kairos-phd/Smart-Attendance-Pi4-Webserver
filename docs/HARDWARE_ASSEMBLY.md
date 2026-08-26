# Hardware assembly guide

## Required parts

- Raspberry Pi 4 Model B (4 GB)
- official-quality 5 V / 3 A USB-C power supply
- two supported USB webcams **or** Raspberry Pi Camera Modules
- microSD card (16 GB minimum; 32 GB recommended) or a tested USB SSD
- heatsink and fan
- Wi-Fi or Ethernet connection

## Power and cooling

1. Attach heatsink/fan with the Pi powered off.
2. Insert the prepared microSD/SSD boot medium.
3. Connect cameras before applying power where practical.
4. Power the Pi only through its USB-C power input with a regulated 5 V/3 A supply. Do **not** power the Pi through GPIO unless a qualified design specifically supports it.
5. Do not rely on an unpowered USB hub for two webcams. If the cameras are unstable or show brownout warnings, use a quality externally powered hub and test it.

## Camera connection

### USB webcams (recommended first choice)

Connect one webcam to each of the Pi's USB ports. Prefer separate USB 3.0 ports when the actual cameras and bandwidth testing support it; some webcams are USB 2.0 and gain no benefit. Identify stable device paths with:

```bash
v4l2-ctl --list-devices
ls -l /dev/v4l/by-id/
```

Use persistent `/dev/v4l/by-id/...` paths in `services/edge/.env` when available, rather than fragile numeric indexes (`0`, `1`).

### Raspberry Pi Camera Modules

The Pi 4 exposes two MIPI CSI camera connectors. The exact cable orientation, connector type and software stack depend on the camera module and the Raspberry Pi OS version. Follow the official instructions for the **actual** camera module; then validate both streams with `rpicam-hello --list-cameras` (or the compatible camera utility for the installed OS). This repository's initial edge implementation targets standard OpenCV/V4L2 sources, so test libcamera/V4L2 bridging before committing to MIPI cameras.

## Network

- Ethernet is preferred for repeatable installation and testing.
- Wi-Fi is supported for deployment. Set a reserved DHCP address or documented hostname to reach the Pi and FastAPI service.
- The system queues events locally during outages, but cloud/dashboard updates resume only after connectivity returns.

## Optional peripherals

| Part | Status | Connection guidance |
| --- | --- | --- |
| HDMI/LCD | Optional debugging/display | Connect through HDMI or the display's own documented interface. It is not needed by the application. |
| LED | Optional | Select GPIO only after the LED module/resistor, desired color and wiring are known. A bare LED must have a current-limiting resistor; never connect it directly without one. |
| Buzzer | Optional | Select a GPIO/power arrangement from the buzzer's voltage/current datasheet. Do not drive a high-current buzzer directly from GPIO. |
| PIR sensor | Excluded from MVP | The documented project decision uses OpenCV motion detection instead. |

No GPIO number is prescribed because the exact optional modules have not been selected. Record the actual module model, voltage, wiring and GPIO mapping before adding a peripheral driver.
