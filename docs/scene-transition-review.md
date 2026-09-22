# Scene transitions — staging

Review route: `/review/responsive`.

Clicking a room scene still plays the approved camera clip. The clip is buffered before the click, and the destination (shelf, desktop, or diploma) starts loading once the movie is on screen, so the landing cut does not sit on a frozen frame. Shelf cubby moves and the return to the room are buffered the same way.

Portrait phones on this route keep one shared 16:9 frame for the room, the camera move, the handoff still, and the landing scene. Existing controls keep their current styling. The approved landscape cover framing is unchanged.

Production home does not enable `responsiveLayout`. The shared preload and overlapped destination load do apply to every room, including home, because they do not change the approved framing.
