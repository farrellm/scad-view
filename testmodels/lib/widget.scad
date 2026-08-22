module widget(n = 8) {
  for (i = [0:n-1])
    rotate([0, 0, i * 360 / n])
      translate([12, 0, 0])
        cylinder(h = 8, r = 3);
}
