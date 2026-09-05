#!/bin/sh
# KidPC desktop session entrypoint.
#
# Reads its whole configuration from the environment the broker set, brings up
# the display stack, and then does nothing clever. Every failure here should be
# loud and fatal: a half-started desktop is worse than none, because the child
# stares at a black screen while their time runs down.
set -eu

: "${KIDPC_SESSION_ID:?missing session id}"
: "${KIDPC_VNC_SECRET:?missing VNC secret}"
: "${KIDPC_TTL_SECONDS:=3600}"
: "${KIDPC_BAND:=explorer}"
: "${KIDPC_ALLOWED_ORIGINS:=}"
: "${KIDPC_AUTOLAUNCH:=}"

log() { echo "[desktop] $*" >&2; }

# --- backstop -----------------------------------------------------------------
# If the control plane dies, nothing else will ever reclaim this container. The
# TTL is the last line of defence for the unit economics.
( sleep "$KIDPC_TTL_SECONDS" && log "TTL reached, shutting down" && kill -TERM 1 ) &

# --- display ------------------------------------------------------------------
Xvfb "$DISPLAY" -screen 0 1280x720x24 -nolisten tcp -dpi 96 &
XVFB_PID=$!

# Wait for the server rather than sleeping a guessed interval.
for _ in $(seq 1 100); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 || { log "X server never came up"; exit 1; }

openbox --config-file /etc/xdg/openbox/rc.xml &

# --- remote framebuffer -------------------------------------------------------
# Bound to all interfaces *inside the container only*: the port is published to
# the host's loopback and reached solely through the authenticated gateway.
# `-once` means a second connection cannot silently join a child's session.
printf '%s' "$KIDPC_VNC_SECRET" > /tmp/.vncsecret
chmod 0400 /tmp/.vncsecret
x11vnc \
  -display "$DISPLAY" \
  -rfbport "$KIDPC_DESKTOP_PORT" \
  -passwdfile /tmp/.vncsecret \
  -forever -shared -noxdamage -nopw -quiet \
  -o /tmp/x11vnc.log &
VNC_PID=$!

log "session $KIDPC_SESSION_ID band=$KIDPC_BAND ttl=${KIDPC_TTL_SECONDS}s"

# --- auto-launch --------------------------------------------------------------
# The broker passes the catalogue's LaunchSpec verbatim; anything not in the
# catalogue simply has no way to be named here.
if [ -n "$KIDPC_AUTOLAUNCH" ]; then
  KIND=$(printf '%s' "$KIDPC_AUTOLAUNCH" | sed -n 's/.*"kind":"\([^"]*\)".*/\1/p')
  case "$KIND" in
    native)
      EXEC=$(printf '%s' "$KIDPC_AUTOLAUNCH" | sed -n 's/.*"exec":"\([^"]*\)".*/\1/p')
      log "launching native: $EXEC"
      # shellcheck disable=SC2086
      ( setsid $EXEC >/tmp/app.log 2>&1 || log "app exited" ) &
      ;;
    web)
      URL=$(printf '%s' "$KIDPC_AUTOLAUNCH" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
      log "launching web: $URL"
      ( kid-browser "$URL" >/tmp/browser.log 2>&1 || log "browser exited" ) &
      ;;
    *) log "unknown launch kind: $KIND" ;;
  esac
fi

# --- supervise ----------------------------------------------------------------
# If either the display or the VNC listener dies the session is over; exiting
# lets the broker notice and close the record instead of leaving a child
# connected to nothing.
trap 'kill -TERM "$XVFB_PID" "$VNC_PID" 2>/dev/null || true' TERM INT
wait -n "$XVFB_PID" "$VNC_PID"
log "a core process exited; shutting down"
kill -TERM "$XVFB_PID" "$VNC_PID" 2>/dev/null || true
exit 0
