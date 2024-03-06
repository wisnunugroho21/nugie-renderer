#include "patched_terrain_mesh.hpp"

#include <stdio.h>

namespace NugieApp {
  PatchedTerrainMesh::PatchedTerrainMesh(TerrainPoints* terrainPoints, float worldScale, uint32_t patchSize) 
    : TerrainMesh(terrainPoints, worldScale), patchSize{patchSize} 
  {

  }

  bool PatchedTerrainMesh::canTerrainBePatched(uint32_t terrainSize, uint32_t patchSize) {
    if ((terrainSize - 1) % (patchSize - 1) != 0) {
      int recommendedWidth = ((terrainSize - 1 + patchSize - 1) / (patchSize - 1)) * (patchSize - 1) + 1;
      printf("Terrain size minus 1 (%d) must be divisible by Patch size minus 1 (%d)\n", terrainSize, patchSize);
      printf("Try using Width = %d\n", recommendedWidth);

      return false;
    }

    if (patchSize < 3) {
      printf("The minimum patch size is 3 (%d)\n", patchSize);
      return false;
    }

    if (patchSize % 2 == 0) {
      printf("Patch size must be an odd number (%d)\n", patchSize);
      return false;
    }

    return true;
  }

  void PatchedTerrainMesh::generateIndices(TerrainPoints* terrainPoints) {
    for (uint32_t z1 = 0 ; z1 < terrainPoints->getSize() - 1 ; z1 += (this->patchSize - 1)) {
      for (uint32_t x1 = 0 ; x1 < terrainPoints->getSize() - 1; x1 += (this->patchSize - 1)) {

        for (uint32_t z = z1; z < z1 + this->patchSize - 1 ; z += 2) {
          for (uint32_t x = x1; x < x1 + this->patchSize - 1 ; x += 2) {
            this->generatePatchIndices(terrainPoints, x1, z1);            
          }
        }
      }
    }    
  }

  void PatchedTerrainMesh::generatePatchIndices(TerrainPoints* terrainPoints, uint32_t curX, uint32_t curZ) {
    for (uint32_t z = curZ; z < curZ + this->patchSize - 1 ; z += 2) {
      for (uint32_t x = curX; x < curX + this->patchSize - 1 ; x += 2) {
        uint32_t indexCenter = (z + 1) * terrainPoints->getSize() + x + 1;

        uint32_t indexTemp1 = z * terrainPoints->getSize() + x;
        uint32_t indexTemp2 = (z + 1) * terrainPoints->getSize() + x;

        this->addTriangle(indexCenter, indexTemp1, indexTemp2);

        indexTemp1 = indexTemp2;
        indexTemp2 += terrainPoints->getSize();

        this->addTriangle(indexCenter, indexTemp1, indexTemp2);

        indexTemp1 = indexTemp2;
        indexTemp2++;

        this->addTriangle(indexCenter, indexTemp1, indexTemp2);

        indexTemp1 = indexTemp2;
        indexTemp2++;

        this->addTriangle(indexCenter, indexTemp1, indexTemp2);

        indexTemp1 = indexTemp2;
        indexTemp2 -= terrainPoints->getSize();

        this->addTriangle(indexCenter, indexTemp1, indexTemp2);

        indexTemp1 = indexTemp2;
        indexTemp2 -= terrainPoints->getSize();

        this->addTriangle(indexCenter, indexTemp1, indexTemp2);

        indexTemp1 = indexTemp2;
        indexTemp2--;

        this->addTriangle(indexCenter, indexTemp1, indexTemp2);

        indexTemp1 = indexTemp2;
        indexTemp2--;

        this->addTriangle(indexCenter, indexTemp1, indexTemp2);
      }
    }
  }
}