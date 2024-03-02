#include "terrain_points.hpp"

namespace NugieApp {
  TerrainPoints::TerrainPoints(uint32_t size) : size{size} {
    for (int i = 0; i < this->size * this->size; i++) {
      this->points.emplace_back(0.0f);
    }
  }

  TerrainPoints::TerrainPoints(uint32_t size, float initialValue) : size{size} {
    for (int i = 0; i < this->size * this->size; i++) {
      this->points.emplace_back(initialValue);
    }
  }

  std::vector<float> TerrainPoints::getAll() { 
    return this->points; 
  }

  float TerrainPoints::get(int x, int z) { 
    return this->points[x + this->size * z];  
  }

  float TerrainPoints::get(uint32_t index) { 
    return this->points[index];  
  }

  void TerrainPoints::set(int x, int z, float height) {
    this->points[x + this->size * z] = height;
  }

  void TerrainPoints::set(uint32_t index, float height) {
    this->points[index] = height;
  }
}