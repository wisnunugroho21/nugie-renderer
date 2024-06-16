#include "descriptor_pool.hpp"

namespace NugieVulkan {
    // *************** Descriptor Pool Builder *********************

    DescriptorPool::Builder &DescriptorPool::Builder::addPoolSize(
            VkDescriptorType descriptorType, uint32_t count) {
        this->poolSizes.push_back({descriptorType, count});
        return *this;
    }

    DescriptorPool::Builder &DescriptorPool::Builder::setPoolFlags(
            VkDescriptorPoolCreateFlags flags) {
        this->poolFlags = flags;
        return *this;
    }

    DescriptorPool::Builder &DescriptorPool::Builder::setMaxSets(uint32_t count) {
        this->maxSets = count;
        return *this;
    }

    DescriptorPool *DescriptorPool::Builder::build() const {
        return new DescriptorPool(this->device, this->maxSets, this->poolFlags, this->poolSizes);
    }

    // *************** Descriptor Pool *********************

    DescriptorPool::DescriptorPool(
            Device *device,
            uint32_t maxSets,
            VkDescriptorPoolCreateFlags poolFlags,
            const std::vector<VkDescriptorPoolSize> &poolSizes)
            : device{device} {
        VkDescriptorPoolCreateInfo descriptorPoolInfo{};
        descriptorPoolInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
        descriptorPoolInfo.poolSizeCount = static_cast<uint32_t>(poolSizes.size());
        descriptorPoolInfo.pPoolSizes = poolSizes.data();
        descriptorPoolInfo.maxSets = maxSets;
        descriptorPoolInfo.flags = poolFlags;

        if (vkCreateDescriptorPool(this->device->getLogicalDevice(), &descriptorPoolInfo, nullptr,
                                   &this->descriptorPool) != VK_SUCCESS) {
            throw std::runtime_error("failed to create descriptor pool!");
        }
    }

    DescriptorPool::~DescriptorPool() {
        vkDestroyDescriptorPool(this->device->getLogicalDevice(), descriptorPool, nullptr);
    }

    bool DescriptorPool::allocate(VkDescriptorSet *descriptor, const VkDescriptorSetLayout &descriptorSetLayout,
                                  const std::vector<uint32_t> &variableSetCounts) const {
        VkDescriptorSetAllocateInfo allocInfo{};
        allocInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
        allocInfo.descriptorPool = this->descriptorPool;
        allocInfo.pSetLayouts = &descriptorSetLayout;
        allocInfo.descriptorSetCount = 1;

        if (!variableSetCounts.empty()) {
            VkDescriptorSetVariableDescriptorCountAllocateInfo setCounts{};
            setCounts.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_VARIABLE_DESCRIPTOR_COUNT_ALLOCATE_INFO;
            setCounts.descriptorSetCount = static_cast<uint32_t>(variableSetCounts.size());
            setCounts.pDescriptorCounts = variableSetCounts.data();

            allocInfo.pNext = &setCounts;
        }

        // Might want to create a "DescriptorPoolManager" class that handles this case, and builds
        // a new pool whenever an old pool fills up. But this is beyond our current scope
        if (vkAllocateDescriptorSets(this->device->getLogicalDevice(), &allocInfo, descriptor) != VK_SUCCESS) {
            return false;
        }

        return true;
    }

    bool DescriptorPool::allocate(std::vector<VkDescriptorSet> &descriptors,
                                  std::vector<VkDescriptorSetLayout> &descriptorSetLayout,
                                  const std::vector<uint32_t> &variableSetCounts) const {
        VkDescriptorSetAllocateInfo allocInfo{};
        allocInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
        allocInfo.descriptorPool = this->descriptorPool;
        allocInfo.pSetLayouts = descriptorSetLayout.data();
        allocInfo.descriptorSetCount = static_cast<uint32_t>(descriptors.size());

        if (!variableSetCounts.empty()) {
            VkDescriptorSetVariableDescriptorCountAllocateInfo setCounts{};
            setCounts.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_VARIABLE_DESCRIPTOR_COUNT_ALLOCATE_INFO;
            setCounts.descriptorSetCount = static_cast<uint32_t>(variableSetCounts.size());
            setCounts.pDescriptorCounts = variableSetCounts.data();

            allocInfo.pNext = &setCounts;
        }

        // Might want to create a "DescriptorPoolManager" class that handles this case, and builds
        // a new pool whenever an old pool fills up. But this is beyond our current scope
        if (vkAllocateDescriptorSets(this->device->getLogicalDevice(), &allocInfo, descriptors.data()) != VK_SUCCESS) {
            return false;
        }

        return true;
    }

    void DescriptorPool::free(VkDescriptorSet *descriptors) const {
        vkFreeDescriptorSets(
                this->device->getLogicalDevice(),
                this->descriptorPool,
                1u,
                descriptors
        );
    }

    void DescriptorPool::free(const std::vector<VkDescriptorSet> &descriptors) const {
        vkFreeDescriptorSets(
                this->device->getLogicalDevice(),
                this->descriptorPool,
                static_cast<uint32_t>(descriptors.size()),
                descriptors.data()
        );
    }

    void DescriptorPool::reset() {
        vkResetDescriptorPool(this->device->getLogicalDevice(), this->descriptorPool, 0);
    }
}