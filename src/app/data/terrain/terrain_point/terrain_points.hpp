#pragma once

#include "../../../general_struct.hpp"

namespace NugieApp {
  class TerrainPoints { 
    public:
      TerrainPoints(uint32_t size);
      TerrainPoints(uint32_t size, float initialValue);

      uint32_t getSize() { return this->size; }
      std::vector<float> getAll();

      float get(int x, int z);
      float get(uint32_t index);

      void set(int x, int z, float height);
      void set(uint32_t index, float height);

    protected:
      std::vector<float> points;
      uint32_t size;
  };
}