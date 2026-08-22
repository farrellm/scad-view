$fn = 100;
difference() {
  sphere(20);
  for (i = [0:12]) rotate([i*17, i*29, i*7]) cylinder(h = 60, r = 3, center = true);
}
