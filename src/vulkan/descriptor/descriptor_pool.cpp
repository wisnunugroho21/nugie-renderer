#include "descriptor_pool.hpp"
 
namespace NugieVulkan {
  // *************** Descriptor Pool Builder *********************
  
  DescriptorPool::Builder& DescriptorPool::Builder::addPoolSize(
      VkDescriptorType descriptorType, uint32_t count) {
    this->poolSizes.push_back({descriptorType, count});
    return *this;
  }
  
  DescriptorPool::Builder& DescriptorPool::Builder::setPoolFlags(
      VkDescriptorPoolCreateFlags flags) {
    this->poolFlags = flags;
    return *this;
  }
  DescriptorPool::Builder& DescriptorPool::Builder::setMaxSets(uint32_t count) {
    this->maxSets = count;
    return *this;
  }
  
  DescriptorPool* DescriptorPool::Builder::build() const {
    return new DescriptorPool(this->device, this->maxSets, this->poolFlags, this->poolSizes);
  }
  
  // *************** Descriptor Pool *********************
  
  DescriptorPool::DescriptorPool(
      Device* device,
      uint32_t maxSets,
      VkDescriptorPoolCreateFlags poolFlags,
      const std::vector<VkDescriptorPoolSize> poolSizes)
      : device{device} 
  {
    VkDescriptorPoolCreateInfo descriptorPoolInfo{};
    descriptorPoolInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    descriptorPoolInfo.poolSizeCount = static_cast<uint32_t>(poolSizes.size());
    descriptorPoolInfo.pPoolSizes = poolSizes.data();
    descriptorPoolInfo.maxSets = maxSets;
    descriptorPoolInfo.flags = poolFlags;
  
    if (vkCreateDescriptorPool(this->device->getLogicalDevice(), &descriptorPoolInfo, nullptr, &this->descriptorPool) != VK_SUCCESS) {
      throw std::runtime_error("failed to create descriptor pool!");
    }
  }
  
  DescriptorPool::~DescriptorPool() {
    vkDestroyDescriptorPool(this->device->getLogicalDevice(), descriptorPool, nullptr);
  }
  
  bool DescriptorPool::allocate(const VkDescriptorSetLayout descriptorSetLayout, VkDescriptorSet *descriptor) const {
    VkDescriptorSetAllocateInfo allocInfo{};
    allocInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    allocInfo.descriptorPool = this->descriptorPool;
    allocInfo.pSetLayouts = &descriptorSetLayout;
    allocInfo.descriptorSetCount = 1;
  
    // Might want to create a "DescriptorPoolManager" class that handles this case, and builds
    // a new pool whenever an old pool fills up. But this is beyond our current scope
    if (vkAllocateDescriptorSets(this->device->getLogicalDevice(), &allocInfo, descriptor) != VK_SUCCESS) {
      return false;
    }
    return true;
  }

  bool DescriptorPool::allocate(std::vector<VkDescriptorSetLayout> descriptorSetLayout, std::vector<VkDescriptorSet*> descriptors) const {
    std::vector<VkDescriptorSet> newDescriptors { descriptors.size() };
    for (uint32_t i = 0; i < descriptors.size(); i++) {
      newDescriptors[i] = *descriptors[i];
    }
    
    VkDescriptorSetAllocateInfo allocInfo{};
    allocInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    allocInfo.descriptorPool = this->descriptorPool;
    allocInfo.pSetLayouts = descriptorSetLayout.data();
    allocInfo.descriptorSetCount = static_cast<uint32_t>(newDescriptors.size());
  
    // Might want to create a "DescriptorPoolManager" class that handles this case, and builds
    // a new pool whenever an old pool fills up. But this is beyond our current scope
    if (vkAllocateDescriptorSets(this->device->getLogicalDevice(), &allocInfo, newDescriptors.data()) != VK_SUCCESS) {
      return false;
    }

    for (uint32_t i = 0; i < descriptors.size(); i++) {
      *descriptors[i] = newDescriptors[i];
    }

    return true;
  }
  
  void DescriptorPool::free(std::vector<VkDescriptorSet*> descriptors) const {
    std::vector<VkDescriptorSet> newDescriptors { descriptors.size() };
    for (uint32_t i = 0; i < descriptors.size(); i++) {
      newDescriptors[i] = *descriptors[i];
    }

    vkFreeDescriptorSets(
      this->device->getLogicalDevice(),
      this->descriptorPool,
      static_cast<uint32_t>(newDescriptors.size()),
      newDescriptors.data()
    );

    for (uint32_t i = 0; i < descriptors.size(); i++) {
      *descriptors[i] = newDescriptors[i];
    }
  }
  
  void DescriptorPool::reset() {
    vkResetDescriptorPool(this->device->getLogicalDevice(), this->descriptorPool, 0);
  }

}