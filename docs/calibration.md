# Table calibration

Hand tracking sees your hand as points on a camera image. Calibration tells it where the table is in that image, and how big your palm looks at the table and at the highest point it should reach. Do it once per camera position, in **Settings → Table calibration**.

## Why eight corners

The camera looks down at the table at some angle, so the table appears in the image as a four-sided shape, not a neat rectangle. Four corners captured on the table define that shape. A palm anywhere inside it is mapped to a point on the table, and the table is mapped onto the arm's workspace (44 cm side to side, 22 cm of reach).

Height comes from how large your palm looks: the nearer the camera, the larger. A palm's apparent size also changes across the image, so the four corners are captured twice, once with the hand flat on the table and once at hover height. Between those, the palm's size is compared with what was captured at the same spot, and turned into a height from the table (0 cm) to the top of the workspace (34 cm).

The palm size is measured from the wrist and knuckles, not the fingers, so spreading your fingers or making a fist does not change the height.

## Capturing

1. Choose the hand camera in **Cameras & hands** first. The calibration belongs to that camera in that position.
2. In **Table calibration**, press **Start camera**.
3. Choose **On the table**. For each corner in turn, lay your hand flat on the table at that corner and press **Capture this corner**. The next corner is outlined.
4. Choose **At hover height** and capture the four corners again, with your hand held at the highest you want the arm to go.

Click a corner in the grid to recapture just that one. **Reset** goes back to a default square and forgets the saved corners.

The calibration is saved in the browser as you capture it. An open stage in another tab picks it up without a reload.

## The three switches

- **Mirror preview** flips the camera preview left to right, so it matches how you look at the table. It does not change the mapping.
- **Swap left/right** reverses side to side in the mapping to the table. It is on by default, which is what makes your hand moving to your left move the arm to your left when you stand behind the arms, the way the stage shows them. If your hand and the arm move opposite ways, change it.
- **Swap near/far** does the same for towards and away from the arms.

## Checking it

With the camera running, the readouts under the corners show the hand's height, thumb spread, and palm size. Move your hand around:

- Flat on the table anywhere inside the corners, the height should read near 0%.
- At hover height, it should read near 100%.
- The **Sandbox** step, in **Camera** mode, drives the twin from your hand, which is the quickest way to see the whole mapping at once.

After moving the camera, or changing to another camera, recapture everything.
