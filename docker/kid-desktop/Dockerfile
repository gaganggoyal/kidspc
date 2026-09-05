# KidPC desktop image.
#
# One container per live session. It holds an X server, a minimal window
# manager, a VNC listener, and the curated applications -- nothing else. There
# is no shell for the child, no package manager at runtime, and no route to the
# internet except through the egress proxy this container is given credentials
# for.
#
# NOT YET BUILT: authored against Debian bookworm package names but never run,
# because no container runtime was available in the environment this was
# written in. Treat the first `docker build` as a real task: expect package
# names and the read-only-rootfs assumptions to need a pass.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    DISPLAY=:1 \
    KIDPC_DESKTOP_PORT=6901

# Kept in one layer, and with recommends off, because image size is pull time
# on every cold host -- which is session start latency for a child.
RUN apt-get update && apt-get install --no-install-recommends -y \
      xvfb x11vnc openbox xterm \
      fonts-dejavu-core fonts-noto-color-emoji \
      dbus-x11 xdg-utils ca-certificates \
      # Explorer
      tuxpaint tuxtype gcompris-qt \
      # Builder
      pcmanfm \
      # Coder
      thonny python3 python3-pip \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      # The locked-down browser used for every `web` catalogue entry
      chromium \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man

# An unprivileged, fixed-uid user. The uid is pinned so the per-child home
# volume keeps working when the image is rebuilt.
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin kid

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY kid-browser /usr/local/bin/kid-browser
COPY openbox-rc.xml /etc/xdg/openbox/rc.xml
RUN chmod 0555 /usr/local/bin/entrypoint.sh /usr/local/bin/kid-browser

USER kid
WORKDIR /home/kid
EXPOSE 6901

# No shell form: the child's session must not get an interactive shell as pid 1.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
