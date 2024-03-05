#include "patched_terrain_mesh.hpp"

namespace NugieApp {
  PatchedTerrainMesh::PatchedTerrainMesh(TerrainPoints* terrainPoints, float worldScale) : TerrainMesh(terrainPoints, worldScale) {}

  void PatchedTerrainMesh::generateIndices(TerrainPoints* terrainPoints, float worldScale) {
    for (uint32_t z = 0 ; z < terrainPoints->getSize() - 1 ; z += 2) {
      for (uint32_t x = 0 ; x < terrainPoints->getSize() - 1 ; x += 2) {
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