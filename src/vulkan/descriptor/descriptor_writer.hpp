#pragma once
 
#include "../device/device.hpp"
#include "descriptor_pool.hpp"
#include "descriptor_set_layout.hpp"
 
// std
#include <memory>
#include <unordered_map>
#include <vector>
 
namespace NugieVulkan {
  class DescriptorWriter {
  public:
    DescriptorWriter(Device* device, DescriptorSetLayout *setLayout, DescriptorPool *pool);
  
    DescriptorWriter& writeBuffer(uint32_t binding, VkDescriptorBufferInfo bufferInfo);
    DescriptorWriter& writeImage(uint32_t binding, VkDescriptorImageInfo imageInfo);
  
    bool build(VkDescriptorSet *set);
    void overwrite(VkDescriptorSet *set);
  
  private:
    Device* device;
    DescriptorSetLayout *setLayout;
    DescriptorPool *pool;
    
    std::vector<VkWriteDescriptorSet> writes;
  };
}  // namespace lve