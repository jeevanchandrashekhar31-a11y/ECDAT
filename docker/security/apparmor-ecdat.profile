# ECDAT Production Container AppArmor Profile
# Restricts filesystem modifications, capabilities, raw sockets, and process tracing.

#include <tunables/global>

profile ecdat-profile flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>

  # Network restrictions: Allow TCP/UDP client and server sockets; deny raw socket crafting
  network inet stream,
  network inet dgram,
  network inet6 stream,
  network inet6 dgram,
  network netlink raw,
  deny network raw,

  # Deny kernel and hardware interactions
  deny mount,
  deny remount,
  deny umount,
  deny pivot_root,
  deny ptrace,
  deny /sys/** rwxklx,
  deny /proc/sys/** rwxklx,
  deny /proc/kcore rw,
  deny /proc/kmem rw,
  deny /dev/mem rw,
  deny /dev/kmem rw,

  # Read-only root filesystem protection: deny writes to system binaries and libraries
  deny /bin/** w,
  deny /sbin/** w,
  deny /usr/bin/** w,
  deny /usr/sbin/** w,
  deny /usr/lib/** w,
  deny /lib/** w,
  deny /lib64/** w,
  deny /etc/** w,

  # Application boundaries
  /app/** r,
  /app/src/** r,
  /opt/ecdat/** r,
  /usr/share/nginx/html/** r,
  /etc/nginx/** r,

  # Temporary writable storage
  /tmp/** rw,
  /var/run/** rw,
  /var/cache/nginx/** rw,
  /var/log/nginx/** rw,

  # Capabilities restriction
  deny capability sys_admin,
  deny capability sys_ptrace,
  deny capability sys_rawio,
  deny capability sys_module,
  deny capability sys_boot,
  deny capability mac_override,
  deny capability mac_admin,
}
